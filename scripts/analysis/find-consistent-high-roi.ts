#!/usr/bin/env npx tsx
/**
 * Find Consistent High ROI Traders (MEDIAN not AVERAGE)
 *
 * Filters:
 * - High win rate (>70%)
 * - HIGH MEDIAN ROI (>30%) - not lottery winners
 * - Low ROI volatility (consistent returns)
 * - Profitable overall (total PnL > $50k)
 * - Meaningful sample size (50+ trades)
 * - Active within last 6 months
 * - Ranked by median ROI (not average)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findConsistentHighROI() {
  console.log('=== Finding Consistent High ROI Traders (70%+ WR, 30%+ MEDIAN ROI) ===\n');

  const tradersResult = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet,
          count() as total_trades,
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
          dateDiff('day', max(resolved_at), now()) as days_since_last
        FROM pm_trade_fifo_roi_v3
        WHERE abs(cost_usd) >= 10  -- Min $10 position size
        GROUP BY wallet
        HAVING total_trades >= 50          -- Meaningful sample size
          AND total_pnl > 50000            -- Min $50k profit
          AND win_rate_pct >= 70           -- HIGH WIN RATE (70%+)
          AND median_roi_pct >= 30         -- HIGH MEDIAN ROI (30%+) - key filter!
          AND days_since_last <= 180       -- Active in last 6 months
      )
      SELECT
        wallet,
        total_trades,
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
        days_since_last
      FROM wallet_stats
      ORDER BY median_roi_pct DESC, win_rate_pct DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    console.log('   Criteria: 50+ trades, >$50k profit, >70% win rate, >30% MEDIAN ROI, active in last 180 days');
    return;
  }

  console.log(`✓ Found ${traders.length} consistent high ROI traders\n`);
  console.log('=== TOP CONSISTENT HIGH ROI TRADERS (MEDIAN ROI, not lottery winners) ===\n');

  traders.forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const holdTime = w.avg_hold_hours < 24 ? `${w.avg_hold_hours}h` : `${(w.avg_hold_hours / 24).toFixed(1)}d`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   💎 ROI: ${w.median_roi_pct}% MEDIAN (avg: ${w.avg_roi_pct}%, stddev: ${w.roi_stddev})`);
    console.log(`   🎯 Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L from ${w.total_trades} trades)`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   ⚡ Frequency: ${tradeFreq} (${w.trading_days} days active)`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   ⏱️  Hold Time: avg ${holdTime}, median ${w.median_hold_hours}h`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${w.days_since_last} days ago)`);
  });

  // Show top recommendations
  console.log('\n\n🎯 TOP RECOMMENDATIONS:\n');

  // Highest MEDIAN ROI
  const topMedianROI = traders[0];
  console.log(`💎 HIGHEST MEDIAN ROI (most consistent):`);
  console.log(`   Wallet: ${topMedianROI.wallet}`);
  console.log(`   Median ROI: ${topMedianROI.median_roi_pct}% (avg: ${topMedianROI.avg_roi_pct}%)`);
  console.log(`   Win Rate: ${topMedianROI.win_rate_pct}% (${topMedianROI.wins}W-${topMedianROI.losses}L)`);
  console.log(`   Profit: $${topMedianROI.total_pnl.toLocaleString()}`);
  console.log(`   Trades: ${topMedianROI.total_trades}`);
  console.log(`   Last Active: ${topMedianROI.days_since_last} days ago\n`);

  // Most active (recent)
  const mostActive = traders.filter(w => w.days_since_last <= 7)
    .reduce((prev, curr) => {
      if (!prev) return curr;
      return (curr.total_trades > prev.total_trades) ? curr : prev;
    }, null as any);

  if (mostActive) {
    console.log(`🔥 MOST ACTIVE (Last 7 days):`);
    console.log(`   Wallet: ${mostActive.wallet}`);
    console.log(`   Median ROI: ${mostActive.median_roi_pct}% (avg: ${mostActive.avg_roi_pct}%)`);
    console.log(`   Win Rate: ${mostActive.win_rate_pct}% (${mostActive.wins}W-${mostActive.losses}L)`);
    console.log(`   Profit: $${mostActive.total_pnl.toLocaleString()}`);
    console.log(`   Trades: ${mostActive.total_trades} | Frequency: ${mostActive.trades_per_day}/day`);
    console.log(`   Last Active: ${mostActive.days_since_last} days ago\n`);
  }

  // Best balanced (High median ROI + Activity + Win Rate + Low Volatility)
  const bestBalanced = traders
    .filter(w => w.days_since_last <= 30 && w.total_trades >= 100)
    .reduce((prev, curr) => {
      if (!prev) return curr;
      // Score = (median_roi * 0.5) + (win_rate * 0.3) + (log(trades) * 10) - (stddev * 0.1)
      const prevScore = (prev.median_roi_pct * 0.5) + (prev.win_rate_pct * 0.3) + (Math.log10(prev.total_trades) * 10) - (prev.roi_stddev * 0.1);
      const currScore = (curr.median_roi_pct * 0.5) + (curr.win_rate_pct * 0.3) + (Math.log10(curr.total_trades) * 10) - (curr.roi_stddev * 0.1);
      return currScore > prevScore ? curr : prev;
    }, null as any);

  if (bestBalanced) {
    console.log(`⭐ BEST BALANCED (Median ROI + Win Rate + Activity + Consistency):`);
    console.log(`   Wallet: ${bestBalanced.wallet}`);
    console.log(`   Median ROI: ${bestBalanced.median_roi_pct}% (avg: ${bestBalanced.avg_roi_pct}%, stddev: ${bestBalanced.roi_stddev})`);
    console.log(`   Win Rate: ${bestBalanced.win_rate_pct}% (${bestBalanced.wins}W-${bestBalanced.losses}L)`);
    console.log(`   Profit: $${bestBalanced.total_pnl.toLocaleString()}`);
    console.log(`   Trades: ${bestBalanced.total_trades} | Frequency: ${bestBalanced.trades_per_day}/day`);
    console.log(`   Last Active: ${bestBalanced.days_since_last} days ago\n`);
  }

  // Most profitable
  const topProfit = traders.reduce((prev, curr) =>
    (curr.total_pnl > prev.total_pnl) ? curr : prev
  );
  console.log(`💰 MOST PROFITABLE:`);
  console.log(`   Wallet: ${topProfit.wallet}`);
  console.log(`   Profit: $${topProfit.total_pnl.toLocaleString()}`);
  console.log(`   Median ROI: ${topProfit.median_roi_pct}% (avg: ${topProfit.avg_roi_pct}%)`);
  console.log(`   Win Rate: ${topProfit.win_rate_pct}% (${topProfit.wins}W-${topProfit.losses}L)`);
  console.log(`   Trades: ${topProfit.total_trades}`);
  console.log(`   Last Active: ${topProfit.days_since_last} days ago\n`);

  // Summary stats
  console.log('\n📊 COHORT STATS:');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length;
  const avgMedianROI = traders.reduce((sum, w) => sum + w.median_roi_pct, 0) / traders.length;
  const avgStddev = traders.reduce((sum, w) => sum + w.roi_stddev, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Average MEDIAN ROI: ${avgMedianROI.toFixed(1)}%`);
  console.log(`   Average ROI Stddev: ${avgStddev.toFixed(1)}% (lower = more consistent)`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Wallets Found: ${traders.length}`);
}

findConsistentHighROI().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
