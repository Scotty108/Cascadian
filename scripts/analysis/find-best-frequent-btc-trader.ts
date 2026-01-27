#!/usr/bin/env npx tsx
/**
 * Find Best High-Frequency Bitcoin Trader for Copy Trading
 *
 * Since specific "15-minute" markets may not exist, this finds wallets that:
 * - Trade Bitcoin markets frequently (high trade count)
 * - Have short holding periods (quick in/out)
 * - High win rate (>55%)
 * - Meaningful ROI per trade (>15% avg to exclude arb)
 * - Ranked by simulated equal-weight copy trading returns
 *
 * This identifies the "bot-like" traders who are consistently profitable
 * on Bitcoin markets regardless of timeframe.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findBestFrequentBitcoinTrader() {
  console.log('=== Finding Best High-Frequency Bitcoin Trader ===\n');

  // Step 1: Find all Bitcoin-related condition IDs
  console.log('Step 1: Identifying Bitcoin markets...');
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question
      FROM (
        SELECT
          condition_id,
          any(question) as question,
          any(volume_usdc) as volume_usdc
        FROM pm_market_metadata
        GROUP BY condition_id
      )
      WHERE (question ILIKE '%bitcoin%'
         OR question ILIKE '%btc%')
        AND NOT (question ILIKE '%dota%')  -- Exclude Dota gaming team
        AND volume_usdc > 1000  -- Min $1k volume
      ORDER BY volume_usdc DESC
      LIMIT 500
    `,
    format: 'JSONEachRow'
  });
  const markets = (await marketsResult.json()) as { condition_id: string; question: string }[];

  if (markets.length === 0) {
    console.log('❌ No Bitcoin markets found');
    return;
  }

  console.log(`✓ Found ${markets.length} Bitcoin markets\n`);
  console.log('Top 5 markets by volume:');
  markets.slice(0, 5).forEach((m, i) => console.log(`  ${i + 1}. ${m.question.slice(0, 80)}...`));
  console.log();

  const conditionIds = markets.map(m => `'${m.condition_id}'`).join(',');

  // Step 2: Find best wallets on these markets
  console.log('Step 2: Analyzing wallet performance...\n');

  const walletStatsResult = await clickhouse.query({
    query: `
      WITH wallet_trades AS (
        SELECT
          wallet,
          pnl_usd,
          roi,
          cost_usd,
          is_short,
          resolved_at,
          entry_time,
          dateDiff('hour', entry_time, resolved_at) as hold_hours
        FROM pm_trade_fifo_roi_v3
        WHERE condition_id IN (${conditionIds})
          AND abs(cost_usd) >= 10  -- Min $10 position size
      )
      SELECT
        wallet,
        count() as total_trades,
        countIf(pnl_usd > 0) as wins,
        countIf(pnl_usd <= 0) as losses,
        round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,

        -- Equal-weight simulation metrics
        sum(roi) as total_roi_sum,
        round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
        round(median(roi) * 100, 1) as median_roi_pct,

        -- Simulated $1 equal-weight copy trading returns
        round(sum(roi) * 100.0 / count(), 1) as sim_roi_per_trade,
        round((sum(roi) / count()) * count() * 100, 0) as sim_total_return_pct,

        -- Money metrics
        round(sum(pnl_usd), 0) as total_pnl,
        round(avg(abs(cost_usd)), 0) as avg_position_size,
        round(sum(abs(cost_usd)), 0) as total_volume,

        -- Frequency metrics
        round(avg(hold_hours), 1) as avg_hold_hours,
        round(median(hold_hours), 1) as median_hold_hours,

        -- Consistency checks
        round(stddevPop(roi) * 100, 1) as roi_stddev,
        countIf(is_short = 1) as short_trades,
        round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

        -- Recency
        max(resolved_at) as last_trade,
        dateDiff('day', max(resolved_at), now()) as days_since_last
      FROM wallet_trades
      GROUP BY wallet
      HAVING total_trades >= 10  -- Minimum sample size
        AND win_rate_pct >= 55   -- Better than coin flip
        AND avg_roi_pct >= 10    -- Meaningful returns (excludes pure arb)
        AND days_since_last <= 180  -- Active within last 6 months
      ORDER BY sim_roi_per_trade DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const wallets = (await walletStatsResult.json()) as any[];

  if (wallets.length === 0) {
    console.log('❌ No wallets found matching criteria');
    console.log('   (min 10 trades, >55% win rate, >10% avg ROI, active in last 180 days)');
    return;
  }

  console.log(`✓ Found ${wallets.length} qualified wallets\n`);
  console.log('=== TOP BITCOIN COPY TRADING CANDIDATES ===\n');

  wallets.forEach((w, i) => {
    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   Win Rate: ${w.win_rate_pct}% (${w.wins}W-${w.losses}L from ${w.total_trades} trades)`);
    console.log(`   Avg ROI per Trade: ${w.avg_roi_pct}% (median: ${w.median_roi_pct}%)`);
    console.log(`   📊 SIMULATED COPY TRADE: ${w.sim_roi_per_trade}% per trade = ${w.sim_total_return_pct}% total return`);
    console.log(`   Total PnL: $${w.total_pnl.toLocaleString()} (avg position: $${w.avg_position_size})`);
    console.log(`   Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   Hold Time: avg ${w.avg_hold_hours}h, median ${w.median_hold_hours}h`);
    console.log(`   Consistency: ${w.roi_stddev}% std dev`);
    console.log(`   Shorts: ${w.short_pct}% (${w.short_trades} trades)`);
    console.log(`   Last Trade: ${w.last_trade} (${w.days_since_last} days ago)`);
  });

  // Show #1 recommendation
  const top = wallets[0];
  console.log('\n\n🎯 RECOMMENDED WALLET TO COPY:');
  console.log(`   ${top.wallet}`);
  console.log(`   → Equal-weight copy trading would yield ${top.sim_roi_per_trade}% per trade`);
  console.log(`   → ${top.win_rate_pct}% win rate over ${top.total_trades} trades`);
  console.log(`   → $${top.total_pnl.toLocaleString()} actual PnL, $${top.total_volume.toLocaleString()} volume`);
  console.log(`   → Avg hold time: ${top.avg_hold_hours} hours (${top.avg_hold_hours < 24 ? 'day trader' : 'swing trader'})`);

  console.log('\n\n💡 NOTE:');
  console.log('   Polymarket may not have dedicated "15-minute" Bitcoin markets.');
  console.log('   These are the best Bitcoin traders overall, optimized for:');
  console.log('   - High win rate (not lottery winners)');
  console.log('   - Consistent returns (not arb bots)');
  console.log('   - Equal-weight copy trading profitability');
}

findBestFrequentBitcoinTrader().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
