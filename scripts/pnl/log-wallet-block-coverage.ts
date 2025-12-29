/**
 * Log Wallet Block Coverage - Per-Wallet Coverage Analysis
 *
 * For wallets with incomplete fills, analyzes what blocks are missing
 * to understand if backfill would help.
 *
 * Usage:
 *   npx tsx scripts/pnl/log-wallet-block-coverage.ts
 *   npx tsx scripts/pnl/log-wallet-block-coverage.ts --wallet 0x1234...
 *   npx tsx scripts/pnl/log-wallet-block-coverage.ts --count 20
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  getWalletBlockStats,
  formatBlock,
  formatCoverage,
  BlockStats,
  TABLE_DEFINITIONS,
} from './lib/blockCoverage';
import { checkWalletFillsCompleteness, FillsCompletenessResult } from './check-fills-completeness';

interface WalletCoverageReport {
  wallet: string;
  fillsComplete: boolean;
  clobMinBlock: number;
  clobMaxBlock: number;
  erc1155MinBlock: number;
  erc1155MaxBlock: number;
  ctfMinBlock: number;
  ctfMaxBlock: number;
  clobTradesBefore37M: number;
  clobTokensBefore37M: number;
  clobUsdcBefore37M: number;
  hasDataGap: boolean;
  gapDescription: string;
}

const ERC1155_START_BLOCK = 37000001; // Known start of ERC1155 data

async function getWalletClobStats(wallet: string): Promise<{
  minBlock: number;
  maxBlock: number;
  totalTrades: number;
  tradesBefore37M: number;
  tokensBefore37M: number;
  usdcBefore37M: number;
}> {
  const walletLower = wallet.toLowerCase();

  const result = await clickhouse.query({
    query: `
      SELECT
        min(block_number) as min_block,
        max(block_number) as max_block,
        count() as total_trades,
        countIf(block_number < ${ERC1155_START_BLOCK}) as trades_before_37m,
        sumIf(token_amount, block_number < ${ERC1155_START_BLOCK}) / 1e6 as tokens_before_37m,
        sumIf(usdc_amount, block_number < ${ERC1155_START_BLOCK}) / 1e6 as usdc_before_37m
      FROM (
        SELECT
          event_id,
          any(block_number) as block_number,
          any(token_amount) as token_amount,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
          AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });

  const row = (await result.json())[0] as any;
  return {
    minBlock: Number(row.min_block || 0),
    maxBlock: Number(row.max_block || 0),
    totalTrades: Number(row.total_trades || 0),
    tradesBefore37M: Number(row.trades_before_37m || 0),
    tokensBefore37M: Number(row.tokens_before_37m || 0),
    usdcBefore37M: Number(row.usdc_before_37m || 0),
  };
}

async function getWalletERC1155Stats(wallet: string): Promise<{ minBlock: number; maxBlock: number; totalTransfers: number }> {
  const walletLower = wallet.toLowerCase();

  const result = await clickhouse.query({
    query: `
      SELECT
        min(block_number) as min_block,
        max(block_number) as max_block,
        count() as total_transfers
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = '${walletLower}'
         OR lower(to_address) = '${walletLower}'
    `,
    format: 'JSONEachRow',
  });

  const row = (await result.json())[0] as any;
  return {
    minBlock: Number(row.min_block || 0),
    maxBlock: Number(row.max_block || 0),
    totalTransfers: Number(row.total_transfers || 0),
  };
}

async function getWalletCTFStats(wallet: string): Promise<{ minBlock: number; maxBlock: number; totalEvents: number }> {
  const walletLower = wallet.toLowerCase();

  // CTF events use different columns - check both stakeholder and user_address
  const result = await clickhouse.query({
    query: `
      SELECT
        min(block_number) as min_block,
        max(block_number) as max_block,
        count() as total_events
      FROM pm_ctf_events
      WHERE lower(stakeholder) = '${walletLower}'
         OR lower(user_address) = '${walletLower}'
    `,
    format: 'JSONEachRow',
  });

  const row = (await result.json())[0] as any;
  return {
    minBlock: Number(row.min_block || 0),
    maxBlock: Number(row.max_block || 0),
    totalEvents: Number(row.total_events || 0),
  };
}

async function analyzeWalletCoverage(wallet: string): Promise<WalletCoverageReport> {
  const [clobStats, erc1155Stats, ctfStats, fillsResult] = await Promise.all([
    getWalletClobStats(wallet),
    getWalletERC1155Stats(wallet),
    getWalletCTFStats(wallet),
    checkWalletFillsCompleteness(wallet, 'Wallet'),
  ]);

  // Determine if there's a data gap
  let hasDataGap = false;
  let gapDescription = '';

  if (clobStats.tradesBefore37M > 0) {
    hasDataGap = true;
    gapDescription = `${clobStats.tradesBefore37M} CLOB trades (${formatBlock(clobStats.tokensBefore37M)} tokens, $${formatBlock(clobStats.usdcBefore37M)}) before ERC1155 data starts (block ${formatBlock(ERC1155_START_BLOCK)})`;
  } else if (clobStats.minBlock > 0 && erc1155Stats.minBlock > clobStats.minBlock + 1000000) {
    hasDataGap = true;
    gapDescription = `ERC1155 starts ${formatBlock(erc1155Stats.minBlock - clobStats.minBlock)} blocks after first CLOB trade`;
  } else if (!fillsResult.fillsComplete && fillsResult.badPositions > 0) {
    hasDataGap = true;
    gapDescription = `${fillsResult.badPositions} positions with token count mismatch (worst diff: ${formatBlock(fillsResult.worstTokenDiff)})`;
  } else {
    gapDescription = 'No significant data gaps detected';
  }

  return {
    wallet,
    fillsComplete: fillsResult.fillsComplete,
    clobMinBlock: clobStats.minBlock,
    clobMaxBlock: clobStats.maxBlock,
    erc1155MinBlock: erc1155Stats.minBlock,
    erc1155MaxBlock: erc1155Stats.maxBlock,
    ctfMinBlock: ctfStats.minBlock,
    ctfMaxBlock: ctfStats.maxBlock,
    clobTradesBefore37M: clobStats.tradesBefore37M,
    clobTokensBefore37M: clobStats.tokensBefore37M,
    clobUsdcBefore37M: clobStats.usdcBefore37M,
    hasDataGap,
    gapDescription,
  };
}

async function getIncompleteWallets(count: number): Promise<string[]> {
  // Get wallets that are likely to have data gaps
  // Prioritize wallets with early CLOB activity and high volume
  const result = await clickhouse.query({
    query: `
      SELECT
        trader_wallet,
        min(block_number) as first_block,
        count() as trade_count,
        sum(usdc_amount) / 1e6 as total_usdc
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trader_wallet != ''
      GROUP BY trader_wallet
      HAVING first_block < ${ERC1155_START_BLOCK}
      ORDER BY total_usdc DESC
      LIMIT ${count}
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map((r) => r.trader_wallet);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const walletIdx = args.indexOf('--wallet');
  const countIdx = args.indexOf('--count');

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    WALLET BLOCK COVERAGE ANALYSIS                          ║');
  console.log('║              Per-Wallet Data Gap Detection for Goldsky Planning            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nGenerated: ${new Date().toISOString()}`);
  console.log(`ERC1155 data starts at block: ${formatBlock(ERC1155_START_BLOCK)}\n`);

  let wallets: string[] = [];

  if (walletIdx !== -1 && args[walletIdx + 1]) {
    wallets = [args[walletIdx + 1]];
  } else {
    const count = countIdx !== -1 && args[countIdx + 1] ? parseInt(args[countIdx + 1]) : 10;
    console.log(`Fetching top ${count} wallets with early CLOB activity...\n`);
    wallets = await getIncompleteWallets(count);
  }

  if (wallets.length === 0) {
    console.log('No wallets found with early CLOB activity.');
    return;
  }

  console.log('═'.repeat(80));
  console.log('WALLET COVERAGE SUMMARY');
  console.log('═'.repeat(80));

  const reports: WalletCoverageReport[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    process.stdout.write(`\rAnalyzing wallet ${i + 1}/${wallets.length}...`);

    try {
      const report = await analyzeWalletCoverage(wallet);
      reports.push(report);
    } catch (err: any) {
      console.error(`\nError analyzing ${wallet}: ${err.message}`);
    }
  }

  console.log('\r' + ' '.repeat(50) + '\r');

  // Print summary table
  console.log(
    '\n' +
      'Wallet'.padEnd(14) +
      ' | ' +
      'Complete'.padEnd(8) +
      ' | ' +
      'CLOB Min'.padStart(12) +
      ' | ' +
      'ERC1155 Min'.padStart(12) +
      ' | ' +
      'Pre-37M Trades'.padStart(14) +
      ' | ' +
      'Gap?'.padStart(5)
  );
  console.log('-'.repeat(80));

  for (const r of reports) {
    console.log(
      r.wallet.slice(0, 12).padEnd(14) +
        ' | ' +
        (r.fillsComplete ? 'YES ✓' : 'NO ✗').padEnd(8) +
        ' | ' +
        formatBlock(r.clobMinBlock).padStart(12) +
        ' | ' +
        formatBlock(r.erc1155MinBlock).padStart(12) +
        ' | ' +
        formatBlock(r.clobTradesBefore37M).padStart(14) +
        ' | ' +
        (r.hasDataGap ? 'YES' : 'NO').padStart(5)
    );
  }

  // Detailed breakdown for wallets with gaps
  const walletsWithGaps = reports.filter((r) => r.hasDataGap);

  if (walletsWithGaps.length > 0) {
    console.log('\n' + '═'.repeat(80));
    console.log('WALLETS WITH DATA GAPS');
    console.log('═'.repeat(80));

    for (const r of walletsWithGaps) {
      console.log(`\n${r.wallet}:`);
      console.log(`  Fills Complete: ${r.fillsComplete ? 'YES' : 'NO'}`);
      console.log(`  CLOB Block Range:    ${formatBlock(r.clobMinBlock)} → ${formatBlock(r.clobMaxBlock)}`);
      console.log(`  ERC1155 Block Range: ${formatBlock(r.erc1155MinBlock)} → ${formatBlock(r.erc1155MaxBlock)}`);
      console.log(`  CTF Block Range:     ${formatBlock(r.ctfMinBlock)} → ${formatBlock(r.ctfMaxBlock)}`);
      if (r.clobTradesBefore37M > 0) {
        console.log(`  Trades before ERC1155: ${r.clobTradesBefore37M} trades, ${formatBlock(r.clobTokensBefore37M)} tokens, $${formatBlock(r.clobUsdcBefore37M)}`);
      }
      console.log(`  Gap: ${r.gapDescription}`);
    }
  }

  // Summary statistics
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('═'.repeat(80));

  const complete = reports.filter((r) => r.fillsComplete);
  const incomplete = reports.filter((r) => !r.fillsComplete);
  const withGaps = reports.filter((r) => r.hasDataGap);
  const withPre37M = reports.filter((r) => r.clobTradesBefore37M > 0);

  console.log(`\n  Total wallets analyzed:     ${reports.length}`);
  console.log(`  Fills complete:             ${complete.length} (${((complete.length / reports.length) * 100).toFixed(1)}%)`);
  console.log(`  Fills incomplete:           ${incomplete.length} (${((incomplete.length / reports.length) * 100).toFixed(1)}%)`);
  console.log(`  With data gaps:             ${withGaps.length} (${((withGaps.length / reports.length) * 100).toFixed(1)}%)`);
  console.log(`  With pre-37M CLOB activity: ${withPre37M.length} (${((withPre37M.length / reports.length) * 100).toFixed(1)}%)`);

  if (withPre37M.length > 0) {
    const totalTradesBefore = withPre37M.reduce((sum, r) => sum + r.clobTradesBefore37M, 0);
    const totalTokensBefore = withPre37M.reduce((sum, r) => sum + r.clobTokensBefore37M, 0);
    const totalUsdcBefore = withPre37M.reduce((sum, r) => sum + r.clobUsdcBefore37M, 0);

    console.log(`\n  Pre-37M activity totals:`);
    console.log(`    Total trades:   ${formatBlock(totalTradesBefore)}`);
    console.log(`    Total tokens:   ${formatBlock(totalTokensBefore)}`);
    console.log(`    Total USDC:     $${formatBlock(totalUsdcBefore)}`);
  }

  // Goldsky recommendation
  console.log('\n' + '═'.repeat(80));
  console.log('GOLDSKY BACKFILL RECOMMENDATION');
  console.log('═'.repeat(80));

  if (withPre37M.length > 0) {
    console.log(`
⚠️  ${withPre37M.length} wallets have CLOB activity before block ${formatBlock(ERC1155_START_BLOCK)}
    where ERC1155 transfer data begins.

    To achieve complete PnL for these wallets, you need to backfill:

    1. ERC1155 Transfers (pm_erc1155_transfers)
       Contract: 0x4d97dcd97ec945f40cf65f87097ace5ea0476045
       Range: Block 0 → ${formatBlock(ERC1155_START_BLOCK - 1)}

    2. ERC20 USDC Transfers (if available)
       Contract: 0x2791bca1f2de4661ed88a30c99a7a9449aa84174
       Range: Match the ERC1155 range

    Without this backfill, wallets with early activity will have:
    - Incorrect token acquisition records
    - Missing cost basis for sold positions
    - Inflated or deflated PnL calculations
`);
  } else {
    console.log(`
✅ No wallets in this sample have significant pre-37M CLOB activity.
   ERC1155 backfill may not be critical for most wallets.

   However, the global block coverage analysis may show different results.
   Run: npx tsx scripts/pnl/log-block-coverage.ts
`);
  }

  console.log('═'.repeat(80));
  console.log('END OF REPORT');
  console.log('═'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
