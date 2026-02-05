#!/usr/bin/env npx tsx
/**
 * Full Sync: pm_trade_fifo_roi_v3 → pm_trade_fifo_roi_v3_mat_unified
 *
 * Syncs ALL resolved LONG positions to the unified table.
 * Uses INSERT + ReplacingMergeTree deduplication (no expensive JOINs).
 * Includes order_id column for accurate trade counting.
 *
 * Run: npx tsx scripts/sync-unified-full.ts
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const host = process.env.CLICKHOUSE_HOST || '';
const url = host.startsWith('http') ? host : `https://${host}:8443`;

const client = createClient({
  url,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    max_execution_time: 600,
  },
});

async function getStats() {
  const result = await client.query({
    query: `
      SELECT
        'primary' as source,
        countIf(is_short = 0 AND resolved_at IS NOT NULL) as resolved_longs,
        countIf(is_short = 0 AND resolved_at IS NULL) as unresolved_longs,
        countIf(order_id != '' AND is_short = 0) as with_order_id
      FROM pm_trade_fifo_roi_v3

      UNION ALL

      SELECT
        'unified',
        countIf(is_short = 0 AND resolved_at IS NOT NULL),
        countIf(is_short = 0 AND resolved_at IS NULL),
        countIf(order_id != '' AND is_short = 0)
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  return await result.json() as any[];
}

async function getMonthsToSync() {
  const result = await client.query({
    query: `
      SELECT DISTINCT toStartOfMonth(entry_time) as month
      FROM pm_trade_fifo_roi_v3
      WHERE is_short = 0
        AND resolved_at IS NOT NULL
      ORDER BY month
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 },
  });
  const data = await result.json() as { month: string }[];
  return data.map(r => r.month);
}

async function syncMonth(month: string): Promise<number> {
  const nextMonth = new Date(month);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().split('T')[0];

  // Count rows in this month from primary
  const countResult = await client.query({
    query: `
      SELECT count() as cnt
      FROM pm_trade_fifo_roi_v3
      WHERE is_short = 0
        AND resolved_at IS NOT NULL
        AND entry_time >= '${month}'
        AND entry_time < '${nextMonthStr}'
    `,
    format: 'JSONEachRow',
  });
  const rowCount = parseInt(((await countResult.json()) as any)[0]?.cnt || '0');

  if (rowCount === 0) {
    return 0;
  }

  // Insert all positions from this month
  // ReplacingMergeTree will dedupe based on sort key
  // IMPORTANT: unified table column order is different from v3
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
         resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
         exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
      SELECT
        v.tx_hash,
        v.order_id,
        v.wallet,
        v.condition_id,
        v.outcome_index,
        v.entry_time,
        v.resolved_at,
        v.tokens,
        v.cost_usd,
        v.tokens_sold_early,
        v.tokens_held,
        v.exit_value,
        v.pnl_usd,
        v.roi,
        v.pct_sold_early,
        v.is_maker,
        1 as is_closed,
        v.is_short
      FROM pm_trade_fifo_roi_v3 v
      WHERE v.is_short = 0
        AND v.resolved_at IS NOT NULL
        AND v.entry_time >= '${month}'
        AND v.entry_time < '${nextMonthStr}'
    `,
    clickhouse_settings: { max_execution_time: 600 },
  });

  return rowCount;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Full Sync: pm_trade_fifo_roi_v3 → unified');
  console.log('(Uses ReplacingMergeTree dedup - safe to run multiple times)');
  console.log('='.repeat(60));

  const startTime = Date.now();

  // Show initial stats
  console.log('\n📊 Initial Stats:');
  const initialStats = await getStats();
  console.table(initialStats);

  // Get months to process
  const months = await getMonthsToSync();
  console.log(`\n📅 Processing ${months.length} months...\n`);

  let totalSynced = 0;
  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const synced = await syncMonth(month);
    totalSynced += synced;

    console.log(`   ${month}: ${synced.toLocaleString()} rows inserted`);
  }

  console.log(`\n📊 Inserted ${totalSynced.toLocaleString()} positions (includes duplicates)`);

  // Run OPTIMIZE FINAL to dedupe
  console.log('\n🔧 Running OPTIMIZE FINAL to deduplicate...');
  await client.command({
    query: 'OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL',
    clickhouse_settings: { max_execution_time: 1200 },
  });
  console.log('   Done');

  // Show final stats
  console.log('\n📊 Final Stats (after dedup):');
  const finalStats = await getStats();
  console.table(finalStats);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n⏱️  Completed in ${elapsed} minutes`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
