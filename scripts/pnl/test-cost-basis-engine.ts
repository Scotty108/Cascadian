/**
 * Test Cost Basis Engine V1
 *
 * Loads CLOB trades for test wallets and processes them through
 * the cost basis engine to:
 * 1. Verify no negative balances (sell capping works)
 * 2. Track external_sell amounts
 * 3. Compare PnL to benchmarks
 *
 * Run with: npx tsx scripts/pnl/test-cost-basis-engine.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  TradeEvent,
  processTradesForWallet,
  checkPositionHealth,
} from '../../lib/pnl/costBasisEngineV1';

interface TestWallet {
  addr: string;
  name: string;
  uiPnl?: number; // From benchmarks
}

const TEST_WALLETS: TestWallet[] = [
  { addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4', uiPnl: 22054858.07 },
  { addr: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm', uiPnl: 5061217.75 },
  { addr: '0xe74a4446efd66a4de690962938f550d8921a40ee', name: 'anon', uiPnl: 11621933.96 },
  { addr: '0x91463565743be18f6b71819234ba5aaaf3845f30', name: 'smoughshammer', uiPnl: 5048115.86 },
];

async function loadTradesForWallet(
  client: any,
  wallet: string
): Promise<TradeEvent[]> {
  // Load deduped CLOB trades (both maker and taker)
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as token_amount,
        any(usdc_amount) / 1000000.0 as usdc_amount,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT *
    FROM deduped
    ORDER BY trade_time
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    eventId: r.event_id,
    wallet: r.wallet,
    tokenId: r.token_id,
    side: r.side as 'buy' | 'sell',
    tokenAmount: Number(r.token_amount),
    usdcAmount: Number(r.usdc_amount),
    timestamp: new Date(r.trade_time),
  }));
}

async function loadResolutions(client: any): Promise<Map<string, number>> {
  // Load resolution prices for all tokens
  // IMPORTANT: payout_numerators can be [1,0] (normalized) or [1000000,0] (raw)
  // V6 formula: if(value >= 1000, 1, value) - don't divide for small values!
  const query = `
    SELECT
      m.token_id_dec as token_id,
      if(
        r.payout_numerators IS NOT NULL,
        if(
          JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000,
          1,
          JSONExtractInt(r.payout_numerators, m.outcome_index + 1)
        ),
        NULL
      ) as resolution_price
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    WHERE r.payout_numerators IS NOT NULL
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const resolutions = new Map<string, number>();
  for (const r of rows) {
    if (r.resolution_price !== null) {
      resolutions.set(r.token_id, Number(r.resolution_price));
    }
  }

  return resolutions;
}

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   TEST COST BASIS ENGINE V1                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load resolutions once
  console.log('Loading resolution prices...');
  const resolutions = await loadResolutions(client);
  console.log(`Loaded ${resolutions.size} resolved tokens\n`);

  // Process each test wallet
  const results: {
    name: string;
    trades: number;
    positions: number;
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    externalSells: number;
    negativeBalances: number;
    uiPnl?: number;
    error?: string;
  }[] = [];

  for (const w of TEST_WALLETS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Processing ${w.name} (${w.addr.slice(0, 10)}...)`);
    console.log(`${'='.repeat(70)}\n`);

    try {
      // Load trades
      console.log('Loading trades...');
      const trades = await loadTradesForWallet(client, w.addr);
      console.log(`Loaded ${trades.length} trades`);

      // Process through cost basis engine
      console.log('Processing through cost basis engine...');
      const result = processTradesForWallet(w.addr, trades, resolutions);

      // Check health
      const health = checkPositionHealth(result.positions);

      console.log('\n--- RESULTS ---\n');
      console.log(`Positions: ${result.positions.length}`);
      console.log(`Realized PnL: $${result.totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`Unrealized PnL: $${result.totalUnrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`Total PnL: $${result.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`External Sells: ${result.totalExternalSells.toLocaleString()} tokens`);
      console.log(`Negative Balances: ${health.negativeBalances}`);

      if (w.uiPnl) {
        const error = ((result.totalPnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100;
        console.log(`\nUI PnL Benchmark: $${w.uiPnl.toLocaleString()}`);
        console.log(`Error: ${error.toFixed(2)}%`);
      }

      // Show top external sells
      if (result.externalSellsByToken.size > 0) {
        console.log('\nTop external sells by token:');
        const sorted = [...result.externalSellsByToken.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        for (const [tokenId, amount] of sorted) {
          console.log(`  ${tokenId.slice(0, 30)}...: ${amount.toLocaleString()}`);
        }
      }

      results.push({
        name: w.name,
        trades: trades.length,
        positions: result.positions.length,
        realizedPnl: result.totalRealizedPnl,
        unrealizedPnl: result.totalUnrealizedPnl,
        totalPnl: result.totalPnl,
        externalSells: result.totalExternalSells,
        negativeBalances: health.negativeBalances,
        uiPnl: w.uiPnl,
      });
    } catch (err: any) {
      console.error(`Error processing ${w.name}: ${err.message}`);
      results.push({
        name: w.name,
        trades: 0,
        positions: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        externalSells: 0,
        negativeBalances: 0,
        error: err.message,
      });
    }
  }

  // Summary table
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('| Wallet | Trades | Total PnL | UI PnL | Error | Ext Sells | Neg Bal |');
  console.log('|--------|--------|-----------|--------|-------|-----------|---------|');

  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.name.padEnd(6)} | ERROR: ${r.error.slice(0, 50)} |`);
      continue;
    }

    const error = r.uiPnl ? (((r.totalPnl - r.uiPnl) / Math.abs(r.uiPnl)) * 100).toFixed(1) + '%' : 'N/A';
    const pnl = '$' + (r.totalPnl / 1000000).toFixed(2) + 'M';
    const ui = r.uiPnl ? '$' + (r.uiPnl / 1000000).toFixed(2) + 'M' : 'N/A';
    const ext = (r.externalSells / 1000000).toFixed(1) + 'M';

    console.log(
      `| ${r.name.padEnd(6)} | ${String(r.trades).padStart(6)} | ${pnl.padStart(9)} | ${ui.padStart(6)} | ${error.padStart(5)} | ${ext.padStart(9)} | ${String(r.negativeBalances).padStart(7)} |`
    );
  }

  console.log('\n\n=== KEY INSIGHTS ===\n');
  console.log('1. Negative Balances = 0 confirms sell capping is working');
  console.log('2. External Sells = tokens sold that were never bought in CLOB');
  console.log('3. High External Sells indicate tokens acquired outside CLOB (PositionSplit, transfers)');
  console.log('4. For full accuracy, would need to add PositionSplit/transfer sources');
}

main().catch(console.error);
