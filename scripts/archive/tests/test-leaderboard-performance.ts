#!/usr/bin/env tsx
/**
 * Test Leaderboard Query Performance
 * Compares: CTE dedupe vs direct view usage
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

async function testQuery(name: string, query: string) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log('━'.repeat(60));

  const start = Date.now();

  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60,
      }
    });

    const rows = await result.json() as any[];
    const duration = Date.now() - start;

    console.log(`✅ Success: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`   Results: ${rows.length} wallets`);
    console.log(`   Top 3 wallets:`);
    rows.slice(0, 3).forEach((w: any, i: number) => {
      console.log(`     ${i+1}. ${w.wallet.slice(0, 10)}... (${w.trades} trades, ${w.win_rate_pct}% WR, ${w.sim_roi_without_top3}% ROI)`);
    });

    return { duration, count: rows.length };
  } catch (error: any) {
    console.error(`❌ Failed: ${error.message}`);
    return { duration: Date.now() - start, error: error.message };
  }
}

async function main() {
  console.log('🔬 Leaderboard Query Performance Test\n');

  // Test 1: Current implementation (with redundant CTE dedupe)
  const currentQuery = `
    WITH deduped_fifo AS (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        any(pnl_usd) as pnl_usd,
        any(cost_usd) as cost_usd,
        any(is_short) as is_short,
        any(resolved_at) as resolved_at
      FROM pm_trade_fifo_roi_v3_deduped
      WHERE resolved_at >= now() - INTERVAL 30 DAY
        AND abs(cost_usd) > 10
      GROUP BY wallet, condition_id, outcome_index
    ),
    wallet_trades AS (
      SELECT
        wallet,
        pnl_usd / nullIf(abs(cost_usd), 1) as roi,
        pnl_usd,
        abs(cost_usd) as cost,
        is_short,
        resolved_at,
        row_number() OVER (PARTITION BY wallet ORDER BY pnl_usd / nullIf(abs(cost_usd), 1) DESC) as rank_desc
      FROM deduped_fifo
    ),
    wallet_stats AS (
      SELECT
        wallet,
        count() as trades,
        countIf(pnl_usd > 0) as wins,
        sum(roi) as total_roi,
        sumIf(roi, rank_desc > 3) as roi_without_top3,
        max(roi) * 100 as best_trade_roi_pct,
        median(roi) * 100 as median_roi_pct,
        sum(pnl_usd) as pnl_30d,
        avg(cost) as avg_position,
        countIf(is_short = 1) as short_trades,
        max(resolved_at) as last_trade
      FROM wallet_trades
      GROUP BY wallet
      HAVING trades >= 25
        AND trades - 3 > 0
        AND max(resolved_at) >= now() - INTERVAL 2 DAY
    )
    SELECT
      wallet,
      round(roi_without_top3 * 100.0 / (trades - 3), 1) as sim_roi_without_top3,
      round(total_roi * 100.0 / trades, 1) as sim_roi_all,
      round(median_roi_pct, 1) as median_roi_pct,
      trades,
      round(wins * 100.0 / trades, 1) as win_rate_pct,
      round(pnl_30d, 0) as pnl_30d,
      round(best_trade_roi_pct, 0) as best_trade_pct,
      round(roi_without_top3 * 100.0 / nullIf(total_roi, 0), 1) as pct_from_other_trades,
      round(avg_position, 0) as avg_position,
      round(short_trades * 100.0 / trades, 1) as short_pct,
      dateDiff('hour', last_trade, now()) as hours_ago
    FROM wallet_stats
    WHERE roi_without_top3 > 0
      AND wins * 100.0 / trades > 40
    ORDER BY sim_roi_without_top3 DESC
    LIMIT 20
  `;

  // Test 2: Optimized (remove redundant CTE dedupe)
  const optimizedQuery = `
    WITH wallet_trades AS (
      SELECT
        wallet,
        pnl_usd / nullIf(abs(cost_usd), 1) as roi,
        pnl_usd,
        abs(cost_usd) as cost,
        is_short,
        resolved_at,
        row_number() OVER (PARTITION BY wallet ORDER BY pnl_usd / nullIf(abs(cost_usd), 1) DESC) as rank_desc
      FROM pm_trade_fifo_roi_v3_deduped
      WHERE resolved_at >= now() - INTERVAL 30 DAY
        AND abs(cost_usd) > 10
    ),
    wallet_stats AS (
      SELECT
        wallet,
        count() as trades,
        countIf(pnl_usd > 0) as wins,
        sum(roi) as total_roi,
        sumIf(roi, rank_desc > 3) as roi_without_top3,
        max(roi) * 100 as best_trade_roi_pct,
        median(roi) * 100 as median_roi_pct,
        sum(pnl_usd) as pnl_30d,
        avg(cost) as avg_position,
        countIf(is_short = 1) as short_trades,
        max(resolved_at) as last_trade
      FROM wallet_trades
      GROUP BY wallet
      HAVING trades >= 25
        AND trades - 3 > 0
        AND max(resolved_at) >= now() - INTERVAL 2 DAY
    )
    SELECT
      wallet,
      round(roi_without_top3 * 100.0 / (trades - 3), 1) as sim_roi_without_top3,
      round(total_roi * 100.0 / trades, 1) as sim_roi_all,
      round(median_roi_pct, 1) as median_roi_pct,
      trades,
      round(wins * 100.0 / trades, 1) as win_rate_pct,
      round(pnl_30d, 0) as pnl_30d,
      round(best_trade_roi_pct, 0) as best_trade_pct,
      round(roi_without_top3 * 100.0 / nullIf(total_roi, 0), 1) as pct_from_other_trades,
      round(avg_position, 0) as avg_position,
      round(short_trades * 100.0 / trades, 1) as short_pct,
      dateDiff('hour', last_trade, now()) as hours_ago
    FROM wallet_stats
    WHERE roi_without_top3 > 0
      AND wins * 100.0 / trades > 40
    ORDER BY sim_roi_without_top3 DESC
    LIMIT 20
  `;

  const result1 = await testQuery('Current (with CTE dedupe)', currentQuery);
  const result2 = await testQuery('Optimized (direct view)', optimizedQuery);

  console.log('\n' + '═'.repeat(60));
  console.log('📊 PERFORMANCE COMPARISON');
  console.log('═'.repeat(60));

  if (!result1.error && !result2.error) {
    const improvement = ((result1.duration - result2.duration) / result1.duration * 100).toFixed(1);
    console.log(`Current:   ${(result1.duration/1000).toFixed(1)}s`);
    console.log(`Optimized: ${(result2.duration/1000).toFixed(1)}s`);
    console.log(`\n${improvement}% faster by removing redundant deduplication CTE`);
  }

  console.log('\n💡 Verdict:');
  if (result2.duration && result2.duration < 3000) {
    console.log('✅ Performance is EXCELLENT (<3s) - regular views work great!');
    console.log('   No need for materialized views.');
  } else if (result2.duration && result2.duration < 5000) {
    console.log('⚠️  Performance is ACCEPTABLE (3-5s) - consider materialized views');
    console.log('   if you need sub-second response times.');
  } else {
    console.log('❌ Performance is TOO SLOW (>5s) - recommend materialized views');
    console.log('   with chunked backfill strategy.');
  }
}

main().catch(console.error);
