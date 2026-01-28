#!/usr/bin/env tsx
/**
 * Test Simple Leaderboard Aggregation
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

async function testQuery(name: string, query: string) {
  console.log(`\n🧪 ${name}`);
  console.log('━'.repeat(60));

  const start = Date.now();

  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 120,
        max_memory_usage: '10000000000', // 10GB
        max_threads: 8,
      }
    });

    const rows = await result.json() as any[];
    const duration = Date.now() - start;

    console.log(`✅ ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`   Results: ${rows.length} wallets`);
    if (rows.length > 0 && rows[0].wallet) {
      console.log(`   Top 3:`);
      rows.slice(0, 3).forEach((w: any, i: number) => {
        console.log(`     ${i+1}. ${w.wallet?.slice(0, 10)}... ${w.total_pnl ? `($${w.total_pnl})` : ''}`);
      });
    }

    return duration;
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🔬 Simple Leaderboard Test\n');

  // Test 1: Basic aggregation (no window functions)
  await testQuery(
    'Test 1: Basic PnL aggregation (30 days)',
    `
      SELECT
        wallet,
        count() as trades,
        round(sum(pnl_usd), 0) as total_pnl,
        round(avg(roi) * 100, 1) as avg_roi_pct
      FROM pm_trade_fifo_roi_v3_deduped
      WHERE resolved_at >= now() - INTERVAL 30 DAY
        AND abs(cost_usd) > 10
      GROUP BY wallet
      ORDER BY total_pnl DESC
      LIMIT 100
    `
  );

  // Test 2: Count how many rows we're scanning
  await testQuery(
    'Test 2: Row count for 30-day filter',
    `
      SELECT count() as total_rows
      FROM pm_trade_fifo_roi_v3_deduped
      WHERE resolved_at >= now() - INTERVAL 30 DAY
        AND abs(cost_usd) > 10
    `
  );

  // Test 3: Full table count
  await testQuery(
    'Test 3: Full table row count',
    `SELECT count() as total_rows FROM pm_trade_fifo_roi_v3_deduped`
  );

  // Test 4: With window function (the problematic one)
  await testQuery(
    'Test 4: With window function (slow)',
    `
      WITH wallet_trades AS (
        SELECT
          wallet,
          pnl_usd,
          cost_usd,
          roi,
          row_number() OVER (PARTITION BY wallet ORDER BY roi DESC) as rank_desc
        FROM pm_trade_fifo_roi_v3_deduped
        WHERE resolved_at >= now() - INTERVAL 30 DAY
          AND abs(cost_usd) > 10
      )
      SELECT
        wallet,
        count() as trades,
        round(sum(pnl_usd), 0) as total_pnl,
        round(sumIf(roi, rank_desc > 3) * 100.0 / nullIf(count() - 3, 0), 1) as sim_roi_without_top3
      FROM wallet_trades
      GROUP BY wallet
      HAVING trades >= 25
      ORDER BY sim_roi_without_top3 DESC
      LIMIT 20
    `
  );
}

main().catch(console.error);
