#!/usr/bin/env npx tsx
/**
 * Find ULTRA ACTIVE Diversified Traders (Last 3 Days, 5+ Markets)
 *
 * Filters:
 * - Active in last 3 days
 * - High win rate (>70%)
 * - HIGH MEDIAN ROI (>30%)
 * - Profitable overall (total PnL > $10k)
 * - Meaningful sample size (30+ trades)
 * - TRADES 5+ DIFFERENT MARKETS (diversification)
 * - Ranked by median ROI
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function find3DayDiversifiedTraders() {
  console.log('=== Finding ULTRA ACTIVE Diversified Traders (Last 3 days, 5+ markets, 70%+ WR, 30%+ MEDIAN ROI) ===\n');

  const tradersResult = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet,
          count() as total_trades,
          uniq(condition_id) as unique_markets,  -- Market diversity
          countIf(pnl_usd > 0) as wins,
          countIf(pnl_usd <= 0) as losses,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,

          -- Overall PnL metrics
          sum(pnl_usd) as total_pnl,
          sumIf(pnl_usd, pnl_usd > 0) as gross_wins,
          sumIf(pnl_usd, pnl_usd < 0) as gross_losses,

          -- ROI metrics (MEDIAN is key!)
          round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
          round(median(roi) * 100, 1) as median_roi_pct,
          round(stddevPop(roi) * 100, 1) as roi_stddev,

          -- Position sizing
          round(avg(abs(cost_usd)), 0) as avg_position_size,
          round(sum(abs(cost_usd)), 0) as total_volume,

          -- Frequency metrics
          dateDiff('day', min(resolved_at), max(resolved_at)) as trading_days,
          round(count() / nullIf(dateDiff('day', min(resolved_at), max(resolved_at)), 0), 1) as trades_per_day,

          -- Hold time
          round(avg(dateDiff('hour', entry_time, resolved_at)), 1) as avg_hold_hours,
          round(median(dateDiff('hour', entry_time, resolved_at)), 1) as median_hold_hours,

          -- Consistency
          countIf(is_short = 1) as short_trades,
          round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

          -- Recency
          max(resolved_at) as last_trade,
          dateDiff('day', max(resolved_at), now()) as days_since_last,
          dateDiff('hour', max(resolved_at), now()) as hours_since_last
        FROM pm_trade_fifo_roi_v3
        WHERE abs(cost_usd) >= 10  -- Min $10 position size
        GROUP BY wallet
        HAVING total_trades >= 30          -- Meaningful sample size
          AND unique_markets > 5           -- MORE THAN 5 MARKETS (diversification)
          AND total_pnl > 10000            -- Min $10k profit
          AND win_rate_pct >= 70           -- HIGH WIN RATE (70%+)
          AND median_roi_pct >= 30         -- HIGH MEDIAN ROI (30%+)
          AND days_since_last <= 3         -- ACTIVE IN LAST 3 DAYS!
      )
      SELECT
        wallet,
        total_trades,
        unique_markets,
        wins,
        losses,
        win_rate_pct,
        round(total_pnl, 0) as total_pnl,
        round(gross_wins, 0) as gross_wins,
        round(gross_losses, 0) as gross_losses,
        avg_roi_pct,
        median_roi_pct,
        roi_stddev,
        avg_position_size,
        total_volume,
        trading_days,
        trades_per_day,
        avg_hold_hours,
        median_hold_hours,
        short_pct,
        last_trade,
        days_since_last,
        hours_since_last
      FROM wallet_stats
      ORDER BY median_roi_pct DESC, unique_markets DESC, win_rate_pct DESC
      LIMIT 200
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    console.log('   Criteria: 30+ trades, >5 markets, >$10k profit, >70% win rate, >30% MEDIAN ROI, active in last 3 days');
    return;
  }

  console.log(`✓ Found ${traders.length} ULTRA ACTIVE DIVERSIFIED traders (last 3 days, 5+ markets)\n`);
  console.log('=== ULTRA ACTIVE DIVERSIFIED TRADERS (Last 3 Days, 5+ Markets) ===\n');

  traders.forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const holdTime = w.avg_hold_hours < 24 ? `${w.avg_hold_hours}h` : `${(w.avg_hold_hours / 24).toFixed(1)}d`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);
    const hoursAgo = w.hours_since_last < 24 ? `${w.hours_since_last}h ago` : `${w.days_since_last}d ago`;
    const tradesPerMarket = (w.total_trades / w.unique_markets).toFixed(1);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   🎨 Markets: ${w.unique_markets} markets (${tradesPerMarket} trades/market)`);
    console.log(`   💎 ROI: ${w.median_roi_pct}% MEDIAN (avg: ${w.avg_roi_pct}%, stddev: ${w.roi_stddev})`);
    console.log(`   🎯 Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L from ${w.total_trades} trades)`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   ⚡ Frequency: ${tradeFreq} (${w.trading_days} days active)`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   ⏱️  Hold Time: avg ${holdTime}, median ${w.median_hold_hours}h`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${hoursAgo})`);
  });

  // Show top recommendations
  console.log('\n\n🎯 TOP RECOMMENDATIONS (ACTIVE LAST 3 DAYS, 5+ MARKETS):\n');

  // Highest MEDIAN ROI
  const topMedianROI = traders[0];
  console.log(`💎 HIGHEST MEDIAN ROI:`);
  console.log(`   Wallet: ${topMedianROI.wallet}`);
  console.log(`   Markets: ${topMedianROI.unique_markets} | Median ROI: ${topMedianROI.median_roi_pct}%`);
  console.log(`   Win Rate: ${topMedianROI.win_rate_pct}% (${topMedianROI.wins}W-${topMedianROI.losses}L)`);
  console.log(`   Profit: $${topMedianROI.total_pnl.toLocaleString()}`);
  console.log(`   Last: ${topMedianROI.hours_since_last}h ago\n`);

  // Most diversified
  const mostDiversified = traders.reduce((prev, curr) =>
    (curr.unique_markets > prev.unique_markets) ? curr : prev
  );
  console.log(`🎨 MOST DIVERSIFIED:`);
  console.log(`   Wallet: ${mostDiversified.wallet}`);
  console.log(`   Markets: ${mostDiversified.unique_markets} | Trades: ${mostDiversified.total_trades}`);
  console.log(`   Median ROI: ${mostDiversified.median_roi_pct}% | Win Rate: ${mostDiversified.win_rate_pct}%`);
  console.log(`   Profit: $${mostDiversified.total_pnl.toLocaleString()}`);
  console.log(`   Last: ${mostDiversified.hours_since_last}h ago\n`);

  // Most profitable
  const topProfit = traders.reduce((prev, curr) =>
    (curr.total_pnl > prev.total_pnl) ? curr : prev
  );
  console.log(`💰 MOST PROFITABLE:`);
  console.log(`   Wallet: ${topProfit.wallet}`);
  console.log(`   Profit: $${topProfit.total_pnl.toLocaleString()}`);
  console.log(`   Markets: ${topProfit.unique_markets} | Median ROI: ${topProfit.median_roi_pct}% | Win Rate: ${topProfit.win_rate_pct}%`);
  console.log(`   Last: ${topProfit.hours_since_last}h ago\n`);

  // Most active (highest trade count)
  const mostActive = traders.reduce((prev, curr) =>
    (curr.total_trades > prev.total_trades) ? curr : prev
  );
  console.log(`🔥 MOST ACTIVE:`);
  console.log(`   Wallet: ${mostActive.wallet}`);
  console.log(`   Trades: ${mostActive.total_trades} across ${mostActive.unique_markets} markets (${(mostActive.total_trades / mostActive.unique_markets).toFixed(1)}/market)`);
  console.log(`   Median ROI: ${mostActive.median_roi_pct}% | Win Rate: ${mostActive.win_rate_pct}%`);
  console.log(`   Profit: $${mostActive.total_pnl.toLocaleString()}`);
  console.log(`   Last: ${mostActive.hours_since_last}h ago\n`);

  // Summary stats
  console.log('\n📊 COHORT STATS (ACTIVE LAST 3 DAYS, 5+ MARKETS):');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length;
  const avgMedianROI = traders.reduce((sum, w) => sum + w.median_roi_pct, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;
  const avgMarkets = traders.reduce((sum, w) => sum + w.unique_markets, 0) / traders.length;

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Average MEDIAN ROI: ${avgMedianROI.toFixed(1)}%`);
  console.log(`   Average Markets: ${avgMarkets.toFixed(1)}`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Wallets Found: ${traders.length}`);

  // Export to CSV
  console.log('\n\n📄 EXPORTING TO CSV...\n');
  const csv = [
    'wallet,unique_markets,total_trades,wins,losses,win_rate_pct,total_pnl,median_roi_pct,avg_roi_pct,roi_stddev,avg_position_size,total_volume,trades_per_day,avg_hold_hours,short_pct,last_trade,hours_since_last',
    ...traders.map(w =>
      `${w.wallet},${w.unique_markets},${w.total_trades},${w.wins},${w.losses},${w.win_rate_pct},${w.total_pnl},${w.median_roi_pct},${w.avg_roi_pct},${w.roi_stddev},${w.avg_position_size},${w.total_volume},${w.trades_per_day},${w.avg_hold_hours},${w.short_pct},${w.last_trade},${w.hours_since_last}`
    )
  ].join('\n');

  const fs = require('fs');
  const csvPath = '/Users/scotty/Projects/Cascadian-app/ultra-active-diversified-3day-traders.csv';
  fs.writeFileSync(csvPath, csv);
  console.log(`✅ Exported ${traders.length} wallets to: ${csvPath}`);
}

find3DayDiversifiedTraders().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
