#!/usr/bin/env npx tsx
/**
 * Find Bitcoin Specialist Traders
 *
 * Filters:
 * - >80% of trades are on Bitcoin markets (specialists, not diversified)
 * - Profitable overall (not just Bitcoin subset)
 * - High win rate (>55%)
 * - Meaningful ROI per trade (>15% avg to exclude arb)
 * - Active within last 6 months
 * - Ranked by simulated equal-weight copy trading returns
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function findBitcoinSpecialists() {
  console.log('=== Finding Bitcoin Specialist Traders ===\n');

  // Step 1: Get Bitcoin condition IDs
  console.log('Step 1: Identifying Bitcoin markets...');
  const marketsResult = await clickhouse.query({
    query: `
      SELECT
        condition_id
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
    `,
    format: 'JSONEachRow'
  });
  const markets = (await marketsResult.json()) as { condition_id: string }[];

  if (markets.length === 0) {
    console.log('❌ No Bitcoin markets found');
    return;
  }

  console.log(`✓ Found ${markets.length} Bitcoin markets\n`);

  // Step 2: Find Bitcoin specialists using JOIN instead of huge IN clause
  console.log('Step 2: Analyzing wallet specialization...\n');

  const specialistsResult = await clickhouse.query({
    query: `
      WITH btc_markets AS (
        SELECT condition_id
        FROM (
          SELECT
            condition_id,
            any(question) as question,
            any(volume_usdc) as volume_usdc
          FROM pm_market_metadata
          GROUP BY condition_id
        )
        WHERE (question ILIKE '%bitcoin%' OR question ILIKE '%btc%')
          AND NOT (question ILIKE '%dota%')
          AND volume_usdc > 1000
      ),
      -- CRITICAL: Deduplicate FIFO table first (278M → 78M rows)
      deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(resolved_at) as resolved_at,
          any(cost_usd) as cost_usd,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3
        GROUP BY wallet, condition_id, outcome_index
      ),
      wallet_all_trades AS (
        SELECT
          t.wallet,
          t.condition_id,
          t.pnl_usd,
          t.roi,
          t.cost_usd,
          t.is_short,
          t.resolved_at,
          -- Mark if this is a Bitcoin trade
          if(b.condition_id IS NOT NULL, 1, 0) as is_btc
        FROM deduped_fifo t
        LEFT JOIN btc_markets b ON t.condition_id = b.condition_id
        WHERE abs(t.cost_usd) >= 10
      ),
      wallet_stats AS (
        SELECT
          wallet,
          count() as total_trades,
          countIf(is_btc = 1) as btc_trades,
          round(countIf(is_btc = 1) * 100.0 / count(), 1) as btc_pct,

          -- Overall metrics (ALL trades)
          sum(pnl_usd) as total_pnl,
          countIf(pnl_usd > 0) as total_wins,
          round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as overall_win_rate,

          -- Bitcoin-only metrics
          sumIf(pnl_usd, is_btc = 1) as btc_pnl,
          countIf(pnl_usd > 0 AND is_btc = 1) as btc_wins,

          -- Copy trading simulation (overall)
          round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
          round(median(roi) * 100, 1) as median_roi_pct,

          -- Position sizing
          round(avg(abs(cost_usd)), 0) as avg_position_size,
          round(sum(abs(cost_usd)), 0) as total_volume,

          -- Consistency
          round(stddevPop(roi) * 100, 1) as roi_stddev,
          countIf(is_short = 1) as short_trades,
          round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct,

          -- Recency
          max(resolved_at) as last_trade,
          dateDiff('day', max(resolved_at), now()) as days_since_last
        FROM wallet_all_trades
        GROUP BY wallet
        HAVING total_trades >= 15              -- Min sample size
          AND btc_pct >= 80                     -- Bitcoin specialist (>80% BTC trades)
          AND total_pnl > 0                     -- Profitable overall
          AND overall_win_rate >= 55            -- Better than coin flip
          AND avg_roi_pct >= 15                 -- Meaningful returns
          AND days_since_last <= 180            -- Active in last 6 months
      )
      SELECT
        wallet,
        total_trades,
        btc_trades,
        btc_pct,
        round(total_pnl, 0) as total_pnl,
        round(btc_pnl, 0) as btc_pnl,
        total_wins,
        btc_wins,
        overall_win_rate,
        round(btc_wins * 100.0 / nullIf(btc_trades, 0), 1) as btc_win_rate,
        avg_roi_pct,
        median_roi_pct,
        avg_position_size,
        total_volume,
        roi_stddev,
        short_pct,
        last_trade,
        days_since_last
      FROM wallet_stats
      ORDER BY total_pnl DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const specialists = (await specialistsResult.json()) as any[];

  if (specialists.length === 0) {
    console.log('❌ No Bitcoin specialists found');
    console.log('   Criteria: >80% Bitcoin trades, profitable overall, >55% win rate, >15% avg ROI');
    return;
  }

  console.log(`✓ Found ${specialists.length} Bitcoin specialist wallets\n`);
  console.log('=== TOP BITCOIN SPECIALISTS (Profitable Overall) ===\n');

  specialists.forEach((w, i) => {
    console.log(`\n${i + 1}. ${w.wallet}`);
    console.log(`   🎯 Bitcoin Focus: ${w.btc_pct}% (${w.btc_trades}/${w.total_trades} trades)`);
    console.log(`   💰 OVERALL PnL: $${w.total_pnl.toLocaleString()} (${w.overall_win_rate}% win rate)`);
    console.log(`   ₿  Bitcoin PnL: $${w.btc_pnl.toLocaleString()} (${w.btc_win_rate}% win rate on BTC)`);
    console.log(`   📊 Avg ROI per Trade: ${w.avg_roi_pct}% (median: ${w.median_roi_pct}%)`);
    console.log(`   💵 Avg Position: $${w.avg_position_size} | Total Volume: $${w.total_volume.toLocaleString()}`);
    console.log(`   📈 Consistency: ${w.roi_stddev}% std dev`);
    console.log(`   📉 Shorts: ${w.short_pct}%`);
    console.log(`   🕐 Last Trade: ${w.last_trade} (${w.days_since_last} days ago)`);
  });

  if (specialists.length > 0) {
    const top = specialists[0];
    console.log('\n\n🎯 TOP BITCOIN SPECIALIST:');
    console.log(`   ${top.wallet}`);
    console.log(`   → ${top.btc_pct}% Bitcoin specialist (${top.btc_trades} BTC trades)`);
    console.log(`   → $${top.total_pnl.toLocaleString()} total profit (${top.overall_win_rate}% win rate)`);
    console.log(`   → ${top.avg_roi_pct}% avg ROI per trade`);
    console.log(`   → $${top.avg_position_size} avg position size`);
  }

  // Summary stats
  console.log('\n\n📊 SPECIALIST COHORT STATS:');
  const avgBtcPct = specialists.reduce((sum, w) => sum + w.btc_pct, 0) / specialists.length;
  const totalProfit = specialists.reduce((sum, w) => sum + w.total_pnl, 0);
  const avgWinRate = specialists.reduce((sum, w) => sum + w.overall_win_rate, 0) / specialists.length;

  console.log(`   Average Bitcoin Focus: ${avgBtcPct.toFixed(1)}%`);
  console.log(`   Total Cohort Profit: $${totalProfit.toLocaleString()}`);
  console.log(`   Average Win Rate: ${avgWinRate.toFixed(1)}%`);
  console.log(`   Wallets Found: ${specialists.length}`);
}

findBitcoinSpecialists().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
