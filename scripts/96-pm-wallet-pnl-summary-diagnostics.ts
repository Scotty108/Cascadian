#!/usr/bin/env tsx
/**
 * Wallet P&L Summary Diagnostics
 *
 * Analyzes pm_wallet_pnl_summary view and reports key metrics.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { appendFileSync } from 'fs';

async function main() {
  console.log('📊 Wallet P&L Summary Diagnostics');
  console.log('='.repeat(60));
  console.log('');

  // === D1: Core Stats ===
  console.log('D1: Core Statistics');
  console.log('-'.repeat(60));
  console.log('');

  const coreStatsQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_wallets,
        COUNT(CASE WHEN pnl_net > 0 THEN 1 END) as profitable_wallets,
        COUNT(CASE WHEN pnl_net < 0 THEN 1 END) as unprofitable_wallets,
        COUNT(CASE WHEN pnl_net = 0 THEN 1 END) as breakeven_wallets,
        COUNT(CASE WHEN markets_with_result = 0 THEN 1 END) as wallets_no_results
      FROM pm_wallet_pnl_summary
    `,
    format: 'JSONEachRow'
  });

  const coreStats = await coreStatsQuery.json();
  console.log('Core Statistics:');
  console.table(coreStats);
  console.log('');

  const totalWallets = parseInt(coreStats[0].total_wallets);
  const profitablePct = parseInt(coreStats[0].profitable_wallets) / totalWallets * 100;
  const unprofitablePct = parseInt(coreStats[0].unprofitable_wallets) / totalWallets * 100;
  const breakevenPct = parseInt(coreStats[0].breakeven_wallets) / totalWallets * 100;
  const noResultsPct = parseInt(coreStats[0].wallets_no_results) / totalWallets * 100;

  console.log(`Profitable Wallets: ${profitablePct.toFixed(2)}%`);
  console.log(`Unprofitable Wallets: ${unprofitablePct.toFixed(2)}%`);
  console.log(`Breakeven Wallets: ${breakevenPct.toFixed(2)}%`);
  console.log(`Wallets with No Win/Loss Results: ${noResultsPct.toFixed(2)}%`);
  console.log('');

  // === D2: P&L Distribution ===
  console.log('D2: P&L Distribution');
  console.log('-'.repeat(60));
  console.log('');

  const pnlDistQuery = await clickhouse.query({
    query: `
      SELECT
        ROUND(MIN(pnl_net), 2) as min_pnl,
        ROUND(quantile(0.25)(pnl_net), 2) as p25_pnl,
        ROUND(quantile(0.50)(pnl_net), 2) as median_pnl,
        ROUND(quantile(0.75)(pnl_net), 2) as p75_pnl,
        ROUND(quantile(0.90)(pnl_net), 2) as p90_pnl,
        ROUND(quantile(0.99)(pnl_net), 2) as p99_pnl,
        ROUND(MAX(pnl_net), 2) as max_pnl,
        ROUND(AVG(pnl_net), 2) as avg_pnl
      FROM pm_wallet_pnl_summary
    `,
    format: 'JSONEachRow'
  });

  const pnlDist = await pnlDistQuery.json();
  console.log('P&L Distribution:');
  console.table(pnlDist);
  console.log('');

  // === D3: Win Rate Histogram ===
  console.log('D3: Win Rate Histogram');
  console.log('-'.repeat(60));
  console.log('');

  const winRateHistQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(CASE WHEN win_rate IS NULL THEN 1 END) as no_win_rate,
        COUNT(CASE WHEN win_rate >= 0.0 AND win_rate < 0.25 THEN 1 END) as win_rate_0_25,
        COUNT(CASE WHEN win_rate >= 0.25 AND win_rate < 0.5 THEN 1 END) as win_rate_25_50,
        COUNT(CASE WHEN win_rate >= 0.5 AND win_rate < 0.75 THEN 1 END) as win_rate_50_75,
        COUNT(CASE WHEN win_rate >= 0.75 AND win_rate <= 1.0 THEN 1 END) as win_rate_75_100
      FROM pm_wallet_pnl_summary
    `,
    format: 'JSONEachRow'
  });

  const winRateHist = await winRateHistQuery.json();
  console.log('Win Rate Histogram:');
  console.table(winRateHist);
  console.log('');

  console.log('Win Rate Distribution:');
  console.log(`  NULL (no results): ${parseInt(winRateHist[0].no_win_rate).toLocaleString()}`);
  console.log(`  0-25%: ${parseInt(winRateHist[0].win_rate_0_25).toLocaleString()}`);
  console.log(`  25-50%: ${parseInt(winRateHist[0].win_rate_25_50).toLocaleString()}`);
  console.log(`  50-75%: ${parseInt(winRateHist[0].win_rate_50_75).toLocaleString()}`);
  console.log(`  75-100%: ${parseInt(winRateHist[0].win_rate_75_100).toLocaleString()}`);
  console.log('');

  // === D4: Top 20 Wallets ===
  console.log('D4: Top 20 Wallets by P&L');
  console.log('-'.repeat(60));
  console.log('');

  const topWalletsQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        total_markets,
        total_trades,
        ROUND(gross_notional, 2) as gross_notional,
        ROUND(pnl_net, 2) as pnl_net,
        winning_markets,
        losing_markets,
        ROUND(win_rate, 4) as win_rate
      FROM pm_wallet_pnl_summary
      ORDER BY pnl_net DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const topWallets = await topWalletsQuery.json();
  console.log('Top 20 Wallets:');
  console.table(topWallets);
  console.log('');

  // === D5: Bottom 20 Wallets ===
  console.log('D5: Bottom 20 Wallets by P&L');
  console.log('-'.repeat(60));
  console.log('');

  const bottomWalletsQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet_short,
        total_markets,
        total_trades,
        ROUND(gross_notional, 2) as gross_notional,
        ROUND(pnl_net, 2) as pnl_net,
        winning_markets,
        losing_markets,
        ROUND(win_rate, 4) as win_rate
      FROM pm_wallet_pnl_summary
      ORDER BY pnl_net ASC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const bottomWallets = await bottomWalletsQuery.json();
  console.log('Bottom 20 Wallets:');
  console.table(bottomWallets);
  console.log('');

  // === SUMMARY ===
  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  console.log(`Total Wallets: ${totalWallets.toLocaleString()}`);
  console.log(`Profitable: ${parseInt(coreStats[0].profitable_wallets).toLocaleString()} (${profitablePct.toFixed(2)}%)`);
  console.log(`Unprofitable: ${parseInt(coreStats[0].unprofitable_wallets).toLocaleString()} (${unprofitablePct.toFixed(2)}%)`);
  console.log('');
  console.log('P&L Distribution:');
  console.log(`  Min: $${parseFloat(pnlDist[0].min_pnl).toLocaleString()}`);
  console.log(`  Median: $${parseFloat(pnlDist[0].median_pnl).toLocaleString()}`);
  console.log(`  Max: $${parseFloat(pnlDist[0].max_pnl).toLocaleString()}`);
  console.log(`  Average: $${parseFloat(pnlDist[0].avg_pnl).toLocaleString()}`);
  console.log('');

  // Append to coverage report
  const report = `

## Wallet P&L Summary (pm_wallet_pnl_summary)

**Created:** ${new Date().toISOString().split('T')[0]}

### Coverage
- **Total Wallets:** ${totalWallets.toLocaleString()}
- **Profitable Wallets:** ${parseInt(coreStats[0].profitable_wallets).toLocaleString()} (${profitablePct.toFixed(2)}%)
- **Unprofitable Wallets:** ${parseInt(coreStats[0].unprofitable_wallets).toLocaleString()} (${unprofitablePct.toFixed(2)}%)
- **Breakeven Wallets:** ${parseInt(coreStats[0].breakeven_wallets).toLocaleString()} (${breakevenPct.toFixed(2)}%)

### P&L Distribution
- **Min P&L:** $${parseFloat(pnlDist[0].min_pnl).toLocaleString()}
- **Median P&L:** $${parseFloat(pnlDist[0].median_pnl).toLocaleString()}
- **Max P&L:** $${parseFloat(pnlDist[0].max_pnl).toLocaleString()}
- **Average P&L:** $${parseFloat(pnlDist[0].avg_pnl).toLocaleString()}
- **P90:** $${parseFloat(pnlDist[0].p90_pnl).toLocaleString()}
- **P99:** $${parseFloat(pnlDist[0].p99_pnl).toLocaleString()}

### Win Rate Distribution
- **NULL (no results):** ${parseInt(winRateHist[0].no_win_rate).toLocaleString()}
- **0-25%:** ${parseInt(winRateHist[0].win_rate_0_25).toLocaleString()}
- **25-50%:** ${parseInt(winRateHist[0].win_rate_25_50).toLocaleString()}
- **50-75%:** ${parseInt(winRateHist[0].win_rate_50_75).toLocaleString()}
- **75-100%:** ${parseInt(winRateHist[0].win_rate_75_100).toLocaleString()}

### Top 5 Wallets by Net P&L
| Wallet | Markets | Trades | P&L Net | Win Rate |
|--------|---------|--------|---------|----------|
${topWallets.slice(0, 5).map(w => `| ${w.wallet_short} | ${w.total_markets} | ${w.total_trades} | $${parseFloat(w.pnl_net).toLocaleString()} | ${(parseFloat(w.win_rate || 0) * 100).toFixed(2)}% |`).join('\n')}

**Status:** ✅ Complete
`;

  try {
    appendFileSync('DATA_COVERAGE_REPORT_C1.md', report);
    console.log('✅ Report appended to DATA_COVERAGE_REPORT_C1.md');
  } catch (error) {
    console.log('⚠️  Could not append to coverage report:', error);
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Diagnostics failed:', error);
  process.exit(1);
});
