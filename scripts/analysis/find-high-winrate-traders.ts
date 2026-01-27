#!/usr/bin/env npx tsx
/**
 * Find High Win Rate Traders (70%+ win rate)
 *
 * Filters:
 * - Very high win rate (>70%)
 * - Profitable overall (total PnL > $50k minimum)
 * - Meaningful sample size (50+ trades)
 * - Active within last 6 months
 * - Ranked by total profit
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findHighWinRateTraders() {
  console.log('=== Finding High Win Rate Traders (70%+) ===\n');

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
        HAVING total_trades >= 50          -- Meaningful sample size
          AND total_pnl > 50000            -- Min $50k profit
          AND win_rate_pct >= 70           -- HIGH WIN RATE (70%+)
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
      ORDER BY win_rate_pct DESC, total_pnl DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const traders = (await tradersResult.json()) as any[];

  if (traders.length === 0) {
    console.log('❌ No high win rate traders found');
    console.log('   Criteria: 50+ trades, >$50k profit, >70% win rate, active in last 180 days');
    return;
  }

  console.log(`✓ Found ${traders.length} high win rate traders (70%+)\n`);
  console.log('=== TOP HIGH WIN RATE TRADERS (70%+ Win Rate) ===\n');

  traders.forEach((w, i) => {
    const tradeFreq = w.trades_per_day >= 1 ? `${w.trades_per_day}/day` : `${(w.trades_per_day * 7).toFixed(1)}/week`;
    const holdTime = w.avg_hold_hours < 24 ? `${w.avg_hold_hours}h` : `${(w.avg_hold_hours / 24).toFixed(1)}d`;
    const profitFactor = Math.abs(w.gross_wins / (w.gross_losses || -1)).toFixed(2);

    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   🎯 Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L from ${w.total_trades} trades)`);
    console.log(`   💰 Total PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   📊 ROI: ${w.avg_roi_pct}% avg (median: ${w.median_roi_pct}%)`);
    console.log(`   ⚡ Frequency: ${tradeFreq} (${w.trading_days} days active)`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   ⏱️  Hold Time: avg ${holdTime}, median ${w.median_hold_hours}h`);
    console.log(`   📉 Profit Factor: ${profitFactor}x | Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${w.days_since_last} days ago)`);
  });

  // Group by win rate tiers
  console.log('\n\n📊 WIN RATE BREAKDOWN:\n');

  const tier95plus = traders.filter(w => w.win_rate_pct >= 95);
  const tier90to95 = traders.filter(w => w.win_rate_pct >= 90 && w.win_rate_pct < 95);
  const tier80to90 = traders.filter(w => w.win_rate_pct >= 80 && w.win_rate_pct < 90);
  const tier70to80 = traders.filter(w => w.win_rate_pct >= 70 && w.win_rate_pct < 80);

  console.log(`95%+ Win Rate: ${tier95plus.length} wallets`);
  console.log(`90-95% Win Rate: ${tier90to95.length} wallets`);
  console.log(`80-90% Win Rate: ${tier80to90.length} wallets`);
  console.log(`70-80% Win Rate: ${tier70to80.length} wallets`);

  // Show top picks by different criteria
  console.log('\n\n🎯 TOP RECOMMENDATIONS:\n');

  // Highest win rate
  const topWinRate = traders[0];
  console.log(`🥇 HIGHEST WIN RATE:`);
  console.log(`   Wallet: ${topWinRate.wallet}`);
  console.log(`   Win Rate: ${topWinRate.win_rate_pct}% (${topWinRate.wins}W-${topWinRate.losses}L)`);
  console.log(`   Profit: $${topWinRate.total_pnl.toLocaleString()}`);
  console.log(`   Trades: ${topWinRate.total_trades} | Avg ROI: ${topWinRate.avg_roi_pct}%`);
  console.log(`   Last Active: ${topWinRate.days_since_last} days ago\n`);

  // Most profitable with 70%+ win rate
  const topProfit = traders.reduce((prev, curr) =>
    (curr.total_pnl > prev.total_pnl) ? curr : prev
  );
  console.log(`💰 MOST PROFITABLE (70%+ win rate):`);
  console.log(`   Wallet: ${topProfit.wallet}`);
  console.log(`   Profit: $${topProfit.total_pnl.toLocaleString()}`);
  console.log(`   Win Rate: ${topProfit.win_rate_pct}% (${topProfit.wins}W-${topProfit.losses}L)`);
  console.log(`   Trades: ${topProfit.total_trades} | Avg ROI: ${topProfit.avg_roi_pct}%`);
  console.log(`   Last Active: ${topProfit.days_since_last} days ago\n`);

  // Most active (recent)
  const mostActive = traders.filter(w => w.days_since_last <= 7)
    .reduce((prev, curr) => {
      if (!prev) return curr;
      return (curr.total_trades > prev.total_trades) ? curr : prev;
    }, null as any);

  if (mostActive) {
    console.log(`🔥 MOST ACTIVE (Last 7 days):`);
    console.log(`   Wallet: ${mostActive.wallet}`);
    console.log(`   Win Rate: ${mostActive.win_rate_pct}% (${mostActive.wins}W-${mostActive.losses}L)`);
    console.log(`   Profit: $${mostActive.total_pnl.toLocaleString()}`);
    console.log(`   Trades: ${mostActive.total_trades} | Frequency: ${mostActive.trades_per_day}/day`);
    console.log(`   Last Active: ${mostActive.days_since_last} days ago\n`);
  }

  // Best for copy trading (balanced)
  const bestCopyTrade = traders
    .filter(w => w.days_since_last <= 30 && w.total_trades >= 100)
    .reduce((prev, curr) => {
      if (!prev) return curr;
      // Score = (win_rate * 0.4) + (profit / 10000 * 0.3) + (trades / 100 * 0.3)
      const prevScore = (prev.win_rate_pct * 0.4) + (prev.total_pnl / 10000 * 0.3) + (prev.total_trades / 100 * 0.3);
      const currScore = (curr.win_rate_pct * 0.4) + (curr.total_pnl / 10000 * 0.3) + (curr.total_trades / 100 * 0.3);
      return currScore > prevScore ? curr : prev;
    }, null as any);

  if (bestCopyTrade) {
    console.log(`⭐ BEST FOR COPY TRADING (balanced score):`);
    console.log(`   Wallet: ${bestCopyTrade.wallet}`);
    console.log(`   Win Rate: ${bestCopyTrade.win_rate_pct}% (${bestCopyTrade.wins}W-${bestCopyTrade.losses}L)`);
    console.log(`   Profit: $${bestCopyTrade.total_pnl.toLocaleString()}`);
    console.log(`   Trades: ${bestCopyTrade.total_trades} | Avg ROI: ${bestCopyTrade.avg_roi_pct}%`);
    console.log(`   Frequency: ${bestCopyTrade.trades_per_day}/day`);
    console.log(`   Last Active: ${bestCopyTrade.days_since_last} days ago\n`);
  }

  // Summary stats
  console.log('\n📊 COHORT STATS:');
  const avgProfit = traders.reduce((sum, w) => sum + w.total_pnl, 0) / traders.length;
  const avgWinRate = traders.reduce((sum, w) => sum + w.win_rate_pct, 0) / traders.length;
  const avgTrades = traders.reduce((sum, w) => sum + w.total_trades, 0) / traders.length;

  console.log(`   Total Cohort Profit: $${traders.reduce((sum, w) => sum + w.total_pnl, 0).toLocaleString()}`);
  console.log(`   Average Profit: $${avgProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Average Trades: ${avgTrades.toFixed(0)}`);
  console.log(`   Wallets Found: ${traders.length}`);
}

findHighWinRateTraders().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
