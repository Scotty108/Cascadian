#!/usr/bin/env npx tsx
/**
 * Hyperdiversified Trader Query - 2 Day Test
 *
 * Queries the new FIFO V5 unified table for high-EV diversified traders
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { writeFileSync } from 'fs';

async function queryHyperdiversifiedTraders() {
  console.log('🔍 Hyperdiversified Trader Query (Last 2 Days)\n');
  console.log('📊 Using: pm_trade_fifo_roi_v3_mat_unified_2d_test\n');
  console.log('Filters:');
  console.log('  - Buy orders in last 2 days (entry_time >= now() - INTERVAL 2 DAY)');
  console.log('  - 7+ unique markets minimum');
  console.log('  - $5 minimum position size per trade');
  console.log('  - Only positive EV wallets (edge_per_trade > 0)');
  console.log('  - Only closed positions (is_closed = 1)\n');
  console.log('Ranking:');
  console.log('  1. Edge per trade (EV formula: W × R_w - (1-W) × R_l)');
  console.log('  2. Win rate (tiebreaker)\n');

  const query = `
    WITH wallet_stats AS (
      SELECT
        wallet,
        uniq(condition_id) as unique_markets,
        count() as total_trades,
        countIf(pnl_usd > 0) as wins,
        countIf(pnl_usd <= 0) as losses,
        countIf(pnl_usd > 0) / count() as win_rate,
        sum(pnl_usd) as total_pnl,
        avg(abs(cost_usd)) as avg_position_size,
        sum(abs(cost_usd)) as total_volume,
        quantileIf(0.5)(roi * 100, pnl_usd > 0) as median_win_roi_pct,
        quantileIf(0.5)(abs(roi) * 100, pnl_usd <= 0) as median_loss_roi_pct,
        countIf(is_short = 1) / count() * 100 as short_pct,
        max(entry_time) as last_trade,
        (now() - max(entry_time)) / 3600 as hours_since_last,
        avg(dateDiff('day', entry_time, coalesce(resolved_at, now()))) as avg_hold_days,
        count() / greatest(1, dateDiff('day', min(entry_time), max(entry_time))) as trades_per_day
      FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
      WHERE is_closed = 1  -- Only closed positions
        AND abs(cost_usd) >= 5  -- Min $5 position size
        AND entry_time >= now() - INTERVAL 2 DAY  -- Buy orders in last 2 days only
      GROUP BY wallet
      HAVING unique_markets >= 7  -- Min 7 markets
    )
    SELECT
      wallet,
      unique_markets,
      total_trades,
      wins,
      losses,
      round(win_rate * 100, 1) as win_rate_pct,
      round(total_pnl, 2) as total_pnl,

      -- Edge per trade (EV formula)
      round(
        (win_rate * median_win_roi_pct) - ((1 - win_rate) * median_loss_roi_pct),
        2
      ) as edge_per_trade_pct,

      -- Compounding score (EV per day held)
      round(
        ((win_rate * median_win_roi_pct) - ((1 - win_rate) * median_loss_roi_pct)) / greatest(1, avg_hold_days),
        2
      ) as compounding_score,

      round(median_win_roi_pct, 1) as median_win_roi_pct,
      round(median_loss_roi_pct, 1) as median_loss_roi_pct,
      round(avg_position_size, 2) as avg_position_size,
      round(total_volume, 2) as total_volume,
      round(avg_hold_days, 1) as avg_hold_days,
      round(trades_per_day, 1) as trades_per_day,
      round(short_pct, 1) as short_pct,
      last_trade,
      round(hours_since_last, 1) as hours_since_last

    FROM wallet_stats
    WHERE (win_rate * median_win_roi_pct) - ((1 - win_rate) * median_loss_roi_pct) > 0  -- Positive EV only
    ORDER BY edge_per_trade_pct DESC, win_rate DESC
    LIMIT 1000
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const rows = await result.json<any>();

  console.log(`Results: ${rows.length} wallets found\n`);
  console.log('---');
  console.log('Top 20 Wallets (Ranked by EV)\n');

  // Print table
  console.log('┌─────┬──────────────┬────────────┬──────────┬────────┬─────────┬─────────────┐');
  console.log('│ Rank│ Wallet       │ Edge/Trade │ Win Rate │ Trades │ Markets │ Total PnL   │');
  console.log('├─────┼──────────────┼────────────┼──────────┼────────┼─────────┼─────────────┤');

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    const rank = (i + 1).toString().padStart(4);
    const wallet = row.wallet.substring(0, 10) + '...';
    const edge = row.edge_per_trade_pct.toFixed(2) + '%';
    const winRate = row.win_rate_pct.toFixed(1) + '%';
    const trades = row.total_trades.toString();
    const markets = row.unique_markets.toString();
    const pnl = '$' + row.total_pnl.toLocaleString();
    const warning = row.total_pnl < 0 ? ' ⚠️' : '';

    console.log(`│ ${rank} │ ${wallet.padEnd(12)} │ ${edge.padStart(10)} │ ${winRate.padStart(8)} │ ${trades.padStart(6)} │ ${markets.padStart(7)} │ ${(pnl + warning).padStart(11)} │`);
  }
  console.log('└─────┴──────────────┴────────────┴──────────┴────────┴─────────┴─────────────┘\n');

  // Special callouts
  const mostDiversified = rows.reduce((max, row) =>
    row.unique_markets > (max?.unique_markets || 0) ? row : max
  , null);

  const highestVolume = rows.reduce((max, row) =>
    row.total_volume > (max?.total_volume || 0) ? row : max
  , null);

  const bestCompounding = rows.reduce((max, row) =>
    row.compounding_score > (max?.compounding_score || 0) ? row : max
  , null);

  console.log('Most Diversified:');
  if (mostDiversified) {
    console.log(`  - ${mostDiversified.wallet.substring(0, 10)}... (#${rows.indexOf(mostDiversified) + 1}) - ${mostDiversified.unique_markets} markets, ${mostDiversified.total_trades} trades, ${mostDiversified.win_rate_pct.toFixed(1)}% win rate, ${mostDiversified.edge_per_trade_pct.toFixed(0)}% edge\n`);
  }

  console.log('Highest Volume:');
  if (highestVolume) {
    const idx = rows.indexOf(highestVolume);
    const warning = highestVolume.total_pnl < 0 ? `, BUT $${Math.abs(highestVolume.total_pnl).toLocaleString()} actual PnL (sizing disaster!)` : '';
    console.log(`  - ${highestVolume.wallet.substring(0, 10)}... (#${idx + 1}) - ${highestVolume.total_trades} trades, ${highestVolume.unique_markets} markets, ${highestVolume.edge_per_trade_pct.toFixed(0)}% edge${warning}\n`);
  }

  console.log('Best Compounding Score:');
  if (bestCompounding) {
    const idx = rows.indexOf(bestCompounding);
    console.log(`  - ${bestCompounding.wallet.substring(0, 10)}... (#${idx + 1}) - ${bestCompounding.compounding_score.toFixed(2)} compounding score (EV/hold_days), ${bestCompounding.total_trades} trades, ${bestCompounding.unique_markets} markets\n`);
  }

  // Export CSV
  const csvPath = '/Users/scotty/Projects/Cascadian-app/hyper-diversified-2day-traders.csv';
  const csvHeader = 'wallet,edge_per_trade_pct,compounding_score,unique_markets,total_trades,wins,losses,win_rate_pct,total_pnl,median_win_roi_pct,median_loss_roi_pct,avg_position_size,total_volume,avg_hold_days,trades_per_day,short_pct,last_trade,hours_since_last\n';
  const csvRows = rows.map(r =>
    `${r.wallet},${r.edge_per_trade_pct},${r.compounding_score},${r.unique_markets},${r.total_trades},${r.wins},${r.losses},${r.win_rate_pct},${r.total_pnl},${r.median_win_roi_pct},${r.median_loss_roi_pct},${r.avg_position_size},${r.total_volume},${r.avg_hold_days},${r.trades_per_day},${r.short_pct},${r.last_trade},${r.hours_since_last}`
  ).join('\n');

  writeFileSync(csvPath, csvHeader + csvRows);

  console.log('---');
  console.log('CSV Export\n');
  console.log(`✅ Full dataset: ${csvPath}\n`);
  console.log('Columns:');
  console.log('  - wallet, edge_per_trade_pct, compounding_score');
  console.log('  - unique_markets, total_trades, wins, losses, win_rate_pct');
  console.log('  - total_pnl, median_win_roi_pct, median_loss_roi_pct');
  console.log('  - avg_position_size, total_volume, avg_hold_days');
  console.log('  - trades_per_day, short_pct, last_trade, hours_since_last\n');
}

queryHyperdiversifiedTraders().catch(console.error);
