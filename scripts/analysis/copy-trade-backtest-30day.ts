#!/usr/bin/env node
/**
 * Copy Trade Backtest (30 Days)
 *
 * Simulates equal-weight copy trading performance:
 * - Each trade gets same capital allocation (e.g., $100)
 * - Returns = sum of all ROIs × fixed capital
 * - Ranks wallets by total return
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import path from 'path';
import { clickhouse } from '../../lib/clickhouse/client';

async function copyTradeBacktest30Day() {
  console.log('=== Copy Trade Backtest (Last 30 Days, Equal-Weight Strategy) ===\n');

  const tradersResult = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet,

          -- Trade counts
          count() as total_trades,
          countIf(pnl_usd > 0) as wins,
          countIf(pnl_usd <= 0) as losses,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,

          -- ROI metrics (key for equal-weight)
          round(avg(roi) * 100, 2) as avg_roi_pct,
          round(median(roi) * 100, 1) as median_roi_pct,

          -- Equal-weight returns (sum of ROIs)
          round(sum(roi) * 100, 2) as total_roi_pct,  -- This × capital = profit

          -- Simulated P&L at different position sizes
          round(sum(roi) * 100, 2) as profit_per_100_usd,  -- $100/trade
          round(sum(roi) * 500, 2) as profit_per_500_usd,  -- $500/trade
          round(sum(roi) * 1000, 2) as profit_per_1k_usd,  -- $1k/trade

          -- Actual performance (for reference)
          round(sum(pnl_usd), 0) as actual_total_pnl,
          round(avg(abs(cost_usd)), 0) as avg_actual_position,

          -- Risk metrics
          round(stddevPop(roi) * 100, 1) as roi_stddev,
          round(min(roi) * 100, 1) as worst_trade_pct,
          round(max(roi) * 100, 1) as best_trade_pct,

          -- Profit factor
          sumIf(pnl_usd, pnl_usd > 0) as gross_wins,
          abs(sumIf(pnl_usd, pnl_usd <= 0)) as gross_losses,

          -- Diversification
          uniq(condition_id) as unique_markets,

          -- Activity
          round(avg(dateDiff('hour', entry_time, resolved_at)), 1) as avg_hold_hours,
          countIf(side = 'SHORT') * 100.0 / count() as short_pct,

          -- Recency
          max(resolved_at) as last_trade,
          dateDiff('hour', max(resolved_at), now()) as hours_since_last

        FROM pm_wallet_condition_realized_v1
        WHERE resolved_at >= now() - INTERVAL 30 DAY
          AND is_deleted = 0
          AND abs(cost_usd) >= 5  -- Min $5 position
        GROUP BY wallet
        HAVING total_trades >= 5  -- Min 5 trades for statistical relevance
      )

      SELECT
        wallet,
        total_trades,
        wins,
        losses,
        win_rate_pct,

        -- Equal-weight returns
        total_roi_pct,
        profit_per_100_usd,
        profit_per_500_usd,
        profit_per_1k_usd,

        -- Per-trade metrics
        avg_roi_pct,
        median_roi_pct,
        roi_stddev,
        worst_trade_pct,
        best_trade_pct,

        -- Actual performance
        actual_total_pnl,
        avg_actual_position,

        -- Risk metrics
        round(gross_wins, 0) as gross_wins,
        round(gross_losses, 0) as gross_losses,
        if(gross_losses > 0, round(gross_wins / gross_losses, 2), 999) as profit_factor,

        unique_markets,
        round(short_pct, 1) as short_pct,
        avg_hold_hours,
        last_trade,
        hours_since_last

      FROM wallet_stats
      ORDER BY profit_per_1k_usd DESC  -- Rank by $1k/trade strategy
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const traders: any[] = [];
  for await (const row of tradersResult.stream()) {
    traders.push(row.json());
  }

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria (30 days, 5+ trades)');
    return;
  }

  console.log(`✓ Found ${traders.length} wallets for copy trade backtest\n`);
  console.log('=== TOP COPY TRADE CANDIDATES (30 Days, Equal-Weight) ===\n');

  traders.slice(0, 20).forEach((w, i) => {
    const profitFactor = w.profit_factor === 999 ? '∞' : w.profit_factor.toFixed(2);
    const hoursAgo = w.hours_since_last < 24 ? `${w.hours_since_last}h ago` : `${Math.floor(w.hours_since_last / 24)}d ago`;

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   💰 Equal-Weight Returns:`);
    console.log(`       $100/trade → $${w.profit_per_100_usd.toLocaleString()} profit (${w.total_roi_pct}% total ROI)`);
    console.log(`       $500/trade → $${w.profit_per_500_usd.toLocaleString()} profit`);
    console.log(`      $1000/trade → $${w.profit_per_1k_usd.toLocaleString()} profit`);
    console.log(`   📊 Performance: ${w.avg_roi_pct}% avg ROI/trade | ${w.median_roi_pct}% median`);
    console.log(`   🎯 Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L from ${w.total_trades} trades)`);
    console.log(`   📈 Best/Worst: +${w.best_trade_pct}% / ${w.worst_trade_pct}% | StdDev: ${w.roi_stddev}%`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Markets: ${w.unique_markets}`);
    console.log(`   💵 Actual PnL: $${w.actual_total_pnl.toLocaleString()} (avg position: $${w.avg_actual_position.toLocaleString()})`);
    console.log(`   ⏱️  Hold Time: ${w.avg_hold_hours}h avg | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${hoursAgo})`);
  });

  // Summary stats
  console.log('\n\n📊 COHORT SUMMARY:\n');
  const avgWinRate = (traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length).toFixed(1);
  const avgROI = (traders.reduce((sum, w) => sum + w.avg_roi_pct, 0) / traders.length).toFixed(2);
  const totalTrades = traders.reduce((sum, w) => sum + w.total_trades, 0);
  const top10Profit1k = traders.slice(0, 10).reduce((sum, w) => sum + w.profit_per_1k_usd, 0);

  console.log(`📌 Cohort: ${traders.length} wallets`);
  console.log(`📌 Avg Win Rate: ${avgWinRate}%`);
  console.log(`📌 Avg ROI/Trade: ${avgROI}%`);
  console.log(`📌 Total Trades: ${totalTrades.toLocaleString()}`);
  console.log(`📌 Top 10 Combined Profit (@$1k/trade): $${top10Profit1k.toLocaleString()}`);

  // Export to CSV
  console.log('\n\n📄 EXPORTING TO CSV...\n');
  const csv = [
    'wallet,total_trades,wins,losses,win_rate_pct,total_roi_pct,profit_per_100_usd,profit_per_500_usd,profit_per_1k_usd,avg_roi_pct,median_roi_pct,roi_stddev,worst_trade_pct,best_trade_pct,actual_total_pnl,avg_actual_position,profit_factor,unique_markets,short_pct,avg_hold_hours,last_trade,hours_since_last',
    ...traders.map(w =>
      `${w.wallet},${w.total_trades},${w.wins},${w.losses},${w.win_rate_pct},${w.total_roi_pct},${w.profit_per_100_usd},${w.profit_per_500_usd},${w.profit_per_1k_usd},${w.avg_roi_pct},${w.median_roi_pct},${w.roi_stddev},${w.worst_trade_pct},${w.best_trade_pct},${w.actual_total_pnl},${w.avg_actual_position},${w.profit_factor},${w.unique_markets},${w.short_pct},${w.avg_hold_hours},${w.last_trade},${w.hours_since_last}`
    )
  ].join('\n');

  const outputPath = path.resolve(process.cwd(), 'copy-trade-backtest-30day.csv');
  writeFileSync(outputPath, csv, 'utf8');
  console.log(`✅ Exported to: ${outputPath}\n`);
}

copyTradeBacktest30Day().catch(console.error);
