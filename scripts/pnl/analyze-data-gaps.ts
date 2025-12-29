/**
 * Analyze Data Gaps - Where Are The Missing Buy Events?
 *
 * For each capped sell (sell > tracked position), identify:
 * 1. Which token was sold
 * 2. What event type triggered the cap (SELL, MERGE, REDEMPTION)
 * 3. How much was capped (untracked tokens)
 * 4. What data source could fill this gap
 *
 * Possible gap sources:
 * - ERC1155 transfers (tokens sent from another wallet)
 * - Missing CLOB trades (pm_trader_events_v2 gaps)
 * - Missing CTF events (pm_ctf_events gaps - splits, merges, redemptions)
 * - Missing condition mappings (can't look up market resolution)
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
  PolymarketPnlEvent,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { clickhouse } from '../../lib/clickhouse/client';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

interface GapInfo {
  tokenId: string;
  eventType: string;
  cappedAmount: bigint;
  timestamp: string;
  txHash: string;
}

interface WalletGapAnalysis {
  wallet: string;
  label: string;
  totalCappedValue: number;
  gaps: GapInfo[];
  uniqueTokensWithGaps: number;
}

async function analyzeWalletGaps(wallet: string, label: string): Promise<WalletGapAnalysis> {
  const events = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
  });
  const sortedEvents = sortEventsByTimestamp(events);
  const state = createEmptyEngineState(wallet);
  const gaps: GapInfo[] = [];

  for (const event of sortedEvents) {
    // Check for capped sell BEFORE applying to state
    if (
      event.eventType === 'ORDER_MATCHED_SELL' ||
      event.eventType === 'MERGE' ||
      event.eventType === 'REDEMPTION'
    ) {
      const posId = wallet.toLowerCase() + '-' + event.tokenId.toString();
      const pos = state.positions.get(posId);
      const posAmount = pos?.amount ?? 0n;

      if (event.amount > posAmount) {
        const excess = event.amount - posAmount;
        gaps.push({
          tokenId: event.tokenId.toString(),
          eventType: event.eventType,
          cappedAmount: excess,
          timestamp: event.timestamp,
          txHash: event.txHash,
        });
      }
    }

    applyEventToState(state, event);
  }

  // Calculate total capped value
  let totalCappedValue = 0n;
  for (const gap of gaps) {
    // Estimate value at $0.50 per token (conservative)
    totalCappedValue += (gap.cappedAmount * 500000n) / COLLATERAL_SCALE;
  }

  const uniqueTokens = new Set(gaps.map((g) => g.tokenId));

  return {
    wallet,
    label,
    totalCappedValue: Number(totalCappedValue) / 1e6,
    gaps,
    uniqueTokensWithGaps: uniqueTokens.size,
  };
}

async function checkErc1155Transfers(wallet: string, tokenIds: string[]): Promise<Map<string, number>> {
  // Check if we have ERC1155 transfer data for these tokens
  const transferCounts = new Map<string, number>();

  if (tokenIds.length === 0) return transferCounts;

  // Check goldsky erc1155 transfers table
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          token_id,
          count() as transfer_count,
          sum(if(to_address = {wallet:String}, value, 0)) / 1e6 as received,
          sum(if(from_address = {wallet:String}, value, 0)) / 1e6 as sent
        FROM goldsky_erc1155_transfers
        WHERE (to_address = {wallet:String} OR from_address = {wallet:String})
          AND token_id IN ({tokenIds:Array(String)})
        GROUP BY token_id
      `,
      query_params: {
        wallet: wallet.toLowerCase(),
        tokenIds: tokenIds.slice(0, 100), // Limit to 100 tokens
      },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as any[];
    for (const row of rows) {
      transferCounts.set(row.token_id, row.transfer_count);
    }
  } catch (e) {
    console.log('  Note: goldsky_erc1155_transfers table not available or error');
  }

  return transferCounts;
}

async function checkClobTradesForToken(wallet: string, tokenId: string): Promise<{ buys: number; sells: number }> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          side,
          count() as cnt
        FROM (
          SELECT any(side) as side
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String}
            AND token_id = {tokenId:String}
            AND is_deleted = 0
          GROUP BY transaction_hash, token_id, side, usdc_amount, token_amount
        )
        GROUP BY side
      `,
      query_params: {
        wallet: wallet.toLowerCase(),
        tokenId,
      },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as any[];
    let buys = 0, sells = 0;
    for (const row of rows) {
      if (row.side === 'BUY') buys = row.cnt;
      if (row.side === 'SELL') sells = row.cnt;
    }
    return { buys, sells };
  } catch (e) {
    return { buys: 0, sells: 0 };
  }
}

async function checkCtfEventsForToken(wallet: string, tokenId: string): Promise<{ splits: number; merges: number; redemptions: number }> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as cnt
        FROM pm_ctf_events
        WHERE stakeholder = {wallet:String}
          AND (
            token_id_yes = {tokenId:String} OR
            token_id_no = {tokenId:String} OR
            toString(token_id) = {tokenId:String}
          )
        GROUP BY event_type
      `,
      query_params: {
        wallet: wallet.toLowerCase(),
        tokenId,
      },
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as any[];
    let splits = 0, merges = 0, redemptions = 0;
    for (const row of rows) {
      if (row.event_type === 'PositionSplit') splits = row.cnt;
      if (row.event_type === 'PositionsMerge') merges = row.cnt;
      if (row.event_type === 'PayoutRedemption') redemptions = row.cnt;
    }
    return { splits, merges, redemptions };
  } catch (e) {
    return { splits: 0, merges: 0, redemptions: 0 };
  }
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('DATA GAP ANALYSIS - WHERE ARE THE MISSING BUY EVENTS?');
  console.log('═'.repeat(80));
  console.log('');

  // First, check what tables we have for ERC1155 transfers
  console.log('--- CHECKING AVAILABLE DATA SOURCES ---\n');

  try {
    const tables = await clickhouse.query({
      query: `
        SELECT name, engine, total_rows
        FROM system.tables
        WHERE database = currentDatabase()
          AND (
            name LIKE '%erc1155%' OR
            name LIKE '%transfer%' OR
            name LIKE '%goldsky%'
          )
        ORDER BY name
      `,
      format: 'JSONEachRow',
    });
    const tableRows = (await tables.json()) as any[];
    console.log('Tables with ERC1155/transfer data:');
    if (tableRows.length === 0) {
      console.log('  ⚠️  NO ERC1155 TRANSFER TABLES FOUND!');
      console.log('  This is likely the source of data gaps.');
    } else {
      for (const row of tableRows) {
        console.log(`  ${row.name}: ${row.total_rows} rows (${row.engine})`);
      }
    }
  } catch (e) {
    console.log('  Error checking tables:', e);
  }

  console.log('');
  console.log('--- ANALYZING GAPS BY WALLET ---\n');

  for (const bm of UI_BENCHMARK_WALLETS) {
    const analysis = await analyzeWalletGaps(bm.wallet, bm.label);

    if (analysis.gaps.length === 0) {
      console.log(`${bm.label}: No data gaps detected ✅`);
      continue;
    }

    console.log(`${bm.label}: ${analysis.gaps.length} capped events, ${analysis.uniqueTokensWithGaps} unique tokens, ~$${analysis.totalCappedValue.toFixed(2)} value`);

    // Analyze top 3 gaps for this wallet
    const sortedGaps = [...analysis.gaps].sort((a, b) =>
      Number(b.cappedAmount) - Number(a.cappedAmount)
    );

    for (const gap of sortedGaps.slice(0, 3)) {
      console.log(`  Token ${gap.tokenId.substring(0, 16)}...`);
      console.log(`    Event: ${gap.eventType}, Capped: ${(Number(gap.cappedAmount) / 1e6).toFixed(2)} tokens`);
      console.log(`    Timestamp: ${gap.timestamp}`);

      // Check what data we have for this token
      const clobStats = await checkClobTradesForToken(bm.wallet, gap.tokenId);
      const ctfStats = await checkCtfEventsForToken(bm.wallet, gap.tokenId);

      console.log(`    CLOB trades: ${clobStats.buys} buys, ${clobStats.sells} sells`);
      console.log(`    CTF events: ${ctfStats.splits} splits, ${ctfStats.merges} merges, ${ctfStats.redemptions} redemptions`);

      // Diagnose the gap
      if (clobStats.buys === 0 && ctfStats.splits === 0) {
        console.log(`    ⚠️  NO BUY SOURCE FOUND - Likely received via ERC1155 transfer`);
      } else if (clobStats.sells > clobStats.buys) {
        console.log(`    ⚠️  MORE SELLS THAN BUYS - Partial transfer + trading`);
      }
    }
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('SUMMARY: WHAT DATA IS MISSING?');
  console.log('═'.repeat(80));
  console.log('');
  console.log('The "capped sells" occur when users sell/redeem tokens that we have');
  console.log('no record of them buying. This happens because:');
  console.log('');
  console.log('1. ERC1155 TRANSFERS (most likely cause)');
  console.log('   - Users receive tokens from other wallets');
  console.log('   - We track CLOB trades, but not direct token transfers');
  console.log('   - Solution: Ingest goldsky erc1155_transfers or similar');
  console.log('');
  console.log('2. SPLIT EVENTS FROM COLLATERAL (possible)');
  console.log('   - Users split USDC collateral into Yes/No tokens');
  console.log('   - These should be in pm_ctf_events, but may be incomplete');
  console.log('   - Solution: Verify pm_ctf_events coverage');
  console.log('');
  console.log('3. HISTORICAL CLOB GAPS (unlikely for recent data)');
  console.log('   - Some early CLOB trades may be missing');
  console.log('   - Solution: Backfill from Polymarket API if needed');
  console.log('');
  console.log('═'.repeat(80));
  console.log('RECOMMENDED ACTIONS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('1. Check if goldsky has ERC1155 transfer data:');
  console.log('   - Look for conditionaltokens contract transfers');
  console.log('   - Contract: 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045');
  console.log('');
  console.log('2. If ERC1155 transfers exist, ingest them as "TRANSFER_IN" events');
  console.log('   - Treat incoming transfers as BUY at $0.50 (neutral cost basis)');
  console.log('   - Or fetch historical prices if available');
  console.log('');
  console.log('3. For perfect UI parity, we need the same data Polymarket uses');
  console.log('   - They likely track all on-chain token movements');
  console.log('   - Not just CLOB + CTF events');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
