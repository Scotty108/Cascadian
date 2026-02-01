#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { readFileSync, writeFileSync } from 'fs';

async function analyzeCopytrade() {
  // Read wallets from CSV
  const csv = readFileSync('/Users/scotty/Projects/Cascadian-app/hyper-diversified-2day-traders.csv', 'utf-8');
  const lines = csv.split('\n').slice(1).filter(l => l.trim());
  const wallets = lines.map(l => l.split(',')[0]);

  console.log(`📊 Analyzing ${wallets.length} wallets for 30-day copytrade performance\n`);
  console.log('Simulating: $1 per trade (equal weight)\n');

  const query = `
    WITH wallet_trades AS (
      SELECT
        wallet,
        count() as total_trades,
        sum(roi) as sum_roi,
        sum(roi * 1.0) as copytrade_pnl,  -- $1 per trade * ROI
        avg(roi * 100) as avg_roi_pct,
        countIf(pnl_usd > 0) / count() * 100 as win_rate,
        max(entry_time) as last_trade
      FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
      WHERE wallet IN [${wallets.map(w => `'${w}'`).join(', ')}]
        AND is_closed = 1
        AND entry_time >= now() - INTERVAL 30 DAY
        AND abs(cost_usd) >= 5
      GROUP BY wallet
    )
    SELECT
      wallet,
      total_trades,
      round(copytrade_pnl, 2) as copytrade_pnl,
      round(avg_roi_pct, 1) as avg_roi_pct,
      round(win_rate, 1) as win_rate_pct,
      last_trade
    FROM wallet_trades
    WHERE copytrade_pnl IS NOT NULL
    ORDER BY copytrade_pnl DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json<any>();

  console.log(`Results: ${rows.length} wallets with trades in last 30 days\n`);
  console.log('Top 30 Wallets for $1 Copytrade (30-day performance)\n');
  console.log('┌─────┬──────────────┬────────┬──────────────┬──────────┬──────────┐');
  console.log('│ Rank│ Wallet       │ Trades │ $1 Copy PnL  │ Avg ROI  │ Win Rate │');
  console.log('├─────┼──────────────┼────────┼──────────────┼──────────┼──────────┤');

  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i];
    const rank = (i + 1).toString().padStart(4);
    const wallet = row.wallet.substring(0, 10) + '...';
    const trades = row.total_trades.toString().padStart(6);
    const pnl = '$' + row.copytrade_pnl.toFixed(2);
    const avgRoi = row.avg_roi_pct.toFixed(1) + '%';
    const winRate = row.win_rate_pct.toFixed(1) + '%';

    console.log(`│ ${rank} │ ${wallet.padEnd(12)} │ ${trades} │ ${pnl.padStart(12)} │ ${avgRoi.padStart(8)} │ ${winRate.padStart(8)} │`);
  }
  console.log('└─────┴──────────────┴────────┴──────────────┴──────────┴──────────┘\n');

  // Summary stats
  const totalPnl = rows.reduce((sum, r) => sum + parseFloat(r.copytrade_pnl), 0);
  const totalTrades = rows.reduce((sum, r) => sum + parseInt(r.total_trades), 0);
  const avgPnlPerWallet = totalPnl / rows.length;

  console.log('Summary:');
  console.log(`  Total PnL (all ${rows.length} wallets): $${totalPnl.toFixed(2)}`);
  console.log(`  Total trades: ${totalTrades.toLocaleString()}`);
  console.log(`  Avg PnL per wallet: $${avgPnlPerWallet.toFixed(2)}`);
  console.log(`  Best wallet: ${rows[0].wallet.substring(0, 10)}... with $${rows[0].copytrade_pnl.toFixed(2)} (${rows[0].total_trades} trades)\n`);

  // Export top performers
  const csvPath = '/Users/scotty/Projects/Cascadian-app/copytrade-30day-analysis.csv';
  const csvHeader = 'wallet,total_trades,copytrade_pnl,avg_roi_pct,win_rate_pct,last_trade\n';
  const csvRows = rows.map(r =>
    `${r.wallet},${r.total_trades},${r.copytrade_pnl},${r.avg_roi_pct},${r.win_rate_pct},${r.last_trade}`
  ).join('\n');

  writeFileSync(csvPath, csvHeader + csvRows);
  console.log(`CSV exported: ${csvPath}\n`);
}

analyzeCopytrade().catch(console.error);
