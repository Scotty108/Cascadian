#!/usr/bin/env npx tsx
/**
 * Find High-Frequency Profitable Traders (ANY category)
 *
 * Filters:
 * - High trade count (100+ trades for meaningful frequency)
 * - Profitable overall (total PnL > 0)
 * - High win rate (>55%)
 * - Meaningful ROI per trade (>15% avg)
 * - Active within last 6 months
 * - Ranked by total profit
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findHighFrequencyTraders() {
  console.log('=== Finding High-Frequency Profitable Traders ===\n');

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
        FROM pm_trade_fifo_roi_v3
        WHERE abs(cost_usd) >= 10  -- Min $10 position size
        GROUP BY wallet
        HAVING total_trades >= 100         -- High frequency (100+ trades)
          AND total_pnl > 0                -- Profitable overall
          AND win_rate_pct >= 55           -- Better than coin flip
          AND avg_roi_pct >= 10            -- Meaningful returns
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
      ORDER BY total_pnl DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No high-frequency traders found');
    console.log('   Criteria: 100+ trades, profitable, >55% win rate, >10% avg ROI, active in last 180 days');
    return;
  }

  console.log(`✓ Found ${traders.length} high-frequency profitable traders\n`);
  console.log('=== TOP HIGH-FREQUENCY TRADERS (All Categories) ===\n');

  traders.forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const holdTime = w.avg_hold_hours < 24 ? `${w.avg_hold_hours}h` : `${(w.avg_hold_hours / 24).toFixed(1)}d`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   📊 Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L from ${w.total_trades} trades)`);
    console.log(`   ⚡ Frequency: ${tradeFreq} (${w.trading_days} days active)`);
    console.log(`   📈 ROI: ${w.avg_roi_pct}% avg (median: ${w.median_roi_pct}%)`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   ⏱️  Hold Time: avg ${holdTime}, median ${w.median_hold_hours}h`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${w.days_since_last} days ago)`);
  });

  // Show top recommendations by different criteria
  console.log('\n\n🎯 TOP PICKS BY CRITERIA:\n');

  // Most profitable
  const topProfit = traders[0];
  console.log(`💰 MOST PROFITABLE:`);
  console.log(`   ${topProfit.wallet}`);
  console.log(`   → $${topProfit.total_pnl.toLocaleString()} profit | ${topProfit.win_rate_pct}% win rate`);
  console.log(`   → ${topProfit.total_trades} trades, ${topProfit.avg_roi_pct}% avg ROI\n`);

  // Most active (highest frequency)
  const topFrequency = traders.reduce((prev, curr) =>
    (curr.trades_per_day > prev.trades_per_day) ? curr : prev
  );
  console.log(`⚡ HIGHEST FREQUENCY:`);
  console.log(`   ${topFrequency.wallet}`);
  console.log(`   → ${topFrequency.trades_per_day} trades/day | ${topFrequency.total_trades} total trades`);
  console.log(`   → $${topFrequency.total_pnl.toLocaleString()} profit, ${topFrequency.win_rate_pct}% win rate\n`);

  // Best win rate
  const topWinRate = traders.reduce((prev, curr) =>
    (curr.win_rate_pct > prev.win_rate_pct) ? curr : prev
  );
  console.log(`🎯 BEST WIN RATE:`);
  console.log(`   ${topWinRate.wallet}`);
  console.log(`   → ${topWinRate.win_rate_pct}% win rate (${topWinRate.wins}W-${topWinRate.losses}L)`);
  console.log(`   → $${topWinRate.total_pnl.toLocaleString()} profit from ${topWinRate.total_trades} trades\n`);

  // Most recent activity
  const mostRecent = traders.reduce((prev, curr) =>
    (curr.days_since_last < prev.days_since_last) ? curr : prev
  );
  console.log(`🔥 MOST RECENTLY ACTIVE:`);
  console.log(`   ${mostRecent.wallet}`);
  console.log(`   → Last trade ${mostRecent.days_since_last} days ago`);
  console.log(`   → $${mostRecent.total_pnl.toLocaleString()} profit, ${mostRecent.win_rate_pct}% win rate\n`);

  // Summary stats
  console.log('\n📊 COHORT STATS:');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;
  const totalVolume = traders.reduce((sum, w) => sum + w.total_volume, 0);

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Total Volume: $${totalVolume.toLocaleString()}`);
  console.log(`   Wallets Found: ${traders.length}`);
}

findHighFrequencyTraders().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
