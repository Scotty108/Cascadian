#!/usr/bin/env npx tsx
/**
 * Find High ROI + High Win Rate Traders
 *
 * Filters:
 * - Very high win rate (>70%)
 * - HIGH ROI per trade (>30% avg)
 * - Profitable overall (total PnL > $50k)
 * - Meaningful sample size (50+ trades)
 * - Active within last 6 months
 * - Ranked by combination of ROI and profit
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findHighROIHighWinRate() {
  console.log('=== Finding High ROI + High Win Rate Traders (70%+ WR, 30%+ ROI) ===\n');

  const tradersResult = await clickhouse.query({
    query: `
      WITH
      -- CRITICAL: Deduplicate FIFO table first (278M → 78M rows)
      deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(cost_usd) as cost_usd,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3
        GROUP BY wallet, condition_id, outcome_index
      ),
      wallet_stats AS (
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

          -- Copy trading simulation
          round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
          round(median(roi) * 100, 1) as median_roi_pct,

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
          round(stddevPop(roi) * 100, 1) as roi_stddev,
          countIf(is_short = 1) as short_trades,
          round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

          -- Recency
          max(resolved_at) as last_trade,
          dateDiff('day', max(resolved_at), now()) as days_since_last
        FROM deduped_fifo
        WHERE abs(cost_usd) >= 10  -- Min $10 position size
        GROUP BY wallet
        HAVING total_trades >= 50          -- Meaningful sample size
          AND total_pnl > 50000            -- Min $50k profit
          AND win_rate_pct >= 70           -- HIGH WIN RATE (70%+)
          AND avg_roi_pct >= 30            -- HIGH ROI (30%+)
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
        avg_position_size,
        total_volume,
        trading_days,
        trades_per_day,
        avg_hold_hours,
        median_hold_hours,
        roi_stddev,
        short_pct,
        last_trade,
        days_since_last
      FROM wallet_stats
      ORDER BY avg_roi_pct DESC, total_pnl DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No traders found matching criteria');
    console.log('   Criteria: 50+ trades, >$50k profit, >70% win rate, >30% ROI, active in last 180 days');
    return;
  }

  console.log(`✓ Found ${traders.length} traders with high ROI + high win rate\n`);
  console.log('=== TOP HIGH ROI + HIGH WIN RATE TRADERS ===\n');

  traders.forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const holdTime = w.avg_hold_hours < 24 ? `${w.avg_hold_hours}h` : `${(w.avg_hold_hours / 24).toFixed(1)}d`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   💎 ROI: ${w.avg_roi_pct}% avg (median: ${w.median_roi_pct}%)`);
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

  // Highest ROI
  const topROI = traders[0];
  console.log(`💎 HIGHEST ROI:`);
  console.log(`   Wallet: ${topROI.wallet}`);
  console.log(`   ROI: ${topROI.avg_roi_pct}% avg (median: ${topROI.median_roi_pct}%)`);
  console.log(`   Win Rate: ${topROI.win_rate_pct}% (${topROI.wins}W-${topROI.losses}L)`);
  console.log(`   Profit: $${topROI.total_pnl.toLocaleString()}`);
  console.log(`   Trades: ${topROI.total_trades}`);
  console.log(`   Last Active: ${topROI.days_since_last} days ago\n`);

  // Most active (recent)
  const mostActive = traders.filter(w => w.days_since_last <= 7)
    .reduce((prev, curr) => {
      if (!prev) return curr;
      return (curr.total_trades > prev.total_trades) ? curr : prev;
    }, null as any);

  if (mostActive) {
    console.log(`🔥 MOST ACTIVE (Last 7 days):`);
    console.log(`   Wallet: ${mostActive.wallet}`);
    console.log(`   ROI: ${mostActive.avg_roi_pct}% avg (median: ${mostActive.median_roi_pct}%)`);
    console.log(`   Win Rate: ${mostActive.win_rate_pct}% (${mostActive.wins}W-${mostActive.losses}L)`);
    console.log(`   Profit: $${mostActive.total_pnl.toLocaleString()}`);
    console.log(`   Trades: ${mostActive.total_trades} | Frequency: ${mostActive.trades_per_day}/day`);
    console.log(`   Last Active: ${mostActive.days_since_last} days ago\n`);
  }

  // Best balanced (ROI + Activity + Win Rate)
  const bestBalanced = traders
    .filter(w => w.days_since_last <= 30 && w.total_trades >= 100)
    .reduce((prev, curr) => {
      if (!prev) return curr;
      // Score = (avg_roi * 0.5) + (win_rate * 0.3) + (log(trades) * 0.2)
      const prevScore = (prev.avg_roi_pct * 0.5) + (prev.win_rate_pct * 0.3) + (Math.log10(prev.total_trades) * 10);
      const currScore = (curr.avg_roi_pct * 0.5) + (curr.win_rate_pct * 0.3) + (Math.log10(curr.total_trades) * 10);
      return currScore > prevScore ? curr : prev;
    }, null as any);

  if (bestBalanced) {
    console.log(`⭐ BEST BALANCED (ROI + Win Rate + Activity):`);
    console.log(`   Wallet: ${bestBalanced.wallet}`);
    console.log(`   ROI: ${bestBalanced.avg_roi_pct}% avg (median: ${bestBalanced.median_roi_pct}%)`);
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
  console.log(`   ROI: ${topProfit.avg_roi_pct}% avg`);
  console.log(`   Win Rate: ${topProfit.win_rate_pct}% (${topProfit.wins}W-${topProfit.losses}L)`);
  console.log(`   Trades: ${topProfit.total_trades}`);
  console.log(`   Last Active: ${topProfit.days_since_last} days ago\n`);

  // Summary stats
  console.log('\n📊 COHORT STATS:');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length;
  const avgROI = traders.reduce((sum, w) => sum + w.avg_roi_pct, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Average ROI: ${avgROI.toFixed(1)}%`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Wallets Found: ${traders.length}`);
}

findHighROIHighWinRate().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
