#!/usr/bin/env npx tsx
/**
 * Fix Epoch Timestamp Corruption in Unified Table
 *
 * This script fixes trades in pm_trade_fifo_roi_v3_mat_unified where
 * resolved_at was corrupted to epoch timestamps (1970-01-01) due to
 * a column ordering bug during sync from pm_trade_fifo_roi_v3.
 *
 * Root cause: The v3 and unified tables have different column orders,
 * and some INSERT statements didn't use explicit column names, causing
 * tokens values to be written to resolved_at (interpreted as Unix timestamp).
 *
 * Strategy:
 * 1. Find all conditions with epoch resolved_at in unified but valid in v3
 * 2. Delete the corrupted rows from unified
 * 3. Re-insert from v3 with correct column mapping
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

const BATCH_SIZE = 100; // conditions per batch

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({
    query: sql,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  return result.json();
}

async function execute(sql: string): Promise<void> {
  await client.command({
    query: sql,
    clickhouse_settings: { max_execution_time: 600 }
  });
}

async function getCorruptedConditions(): Promise<{ condition_id: string; corrupt_count: number }[]> {
  console.log('Finding conditions with corrupted timestamps...');

  // Find conditions where unified has epoch resolved_at but v3 has valid
  const result = await query<{ condition_id: string; corrupt_count: number }>(`
    SELECT
      u.condition_id,
      count() as corrupt_count
    FROM pm_trade_fifo_roi_v3_mat_unified u
    WHERE u.resolved_at < '1971-01-01'
      AND u.resolved_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pm_trade_fifo_roi_v3 v
        WHERE v.condition_id = u.condition_id
          AND v.resolved_at >= '2020-01-01'
      )
    GROUP BY u.condition_id
    ORDER BY corrupt_count DESC
  `);

  return result;
}

async function fixConditionBatch(conditions: string[]): Promise<number> {
  const conditionList = conditions.map(c => `'${c}'`).join(',');

  // Step 1: Count rows to be fixed
  const countResult = await query<{ cnt: number }>(`
    SELECT count() as cnt
    FROM pm_trade_fifo_roi_v3_mat_unified
    WHERE condition_id IN (${conditionList})
      AND resolved_at < '1971-01-01'
  `);
  const toFix = countResult[0]?.cnt || 0;

  if (toFix === 0) {
    return 0;
  }

  // Step 2: Delete corrupted rows
  await execute(`
    ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
    DELETE WHERE condition_id IN (${conditionList})
      AND resolved_at < '1971-01-01'
  `);

  // Step 3: Wait for mutation to complete
  let mutationDone = false;
  let attempts = 0;
  while (!mutationDone && attempts < 120) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const mutationCheck = await query<{ pending: number }>(`
      SELECT count() as pending
      FROM system.mutations
      WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
        AND is_done = 0
    `);
    mutationDone = (mutationCheck[0]?.pending || 0) === 0;
    attempts++;
    if (attempts % 10 === 0) {
      console.log(`    Waiting for mutation... (${attempts}s)`);
    }
  }

  // Step 4: Re-insert from v3 with explicit column names
  // Only insert rows that were deleted (condition_id match and entry exists in v3)
  await execute(`
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      (tx_hash, wallet, condition_id, outcome_index, entry_time,
       resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
       exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
    SELECT
      v.tx_hash,
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
      CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
      v.is_short
    FROM pm_trade_fifo_roi_v3 v
    LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
      ON v.tx_hash = u.tx_hash
      AND v.wallet = u.wallet
      AND v.condition_id = u.condition_id
      AND v.outcome_index = u.outcome_index
    WHERE v.condition_id IN (${conditionList})
      AND v.resolved_at >= '2020-01-01'
      AND u.tx_hash IS NULL
  `);

  return toFix;
}

async function getStats() {
  const result = await query<{
    total_unified: number;
    epoch_unified: number;
    epoch_pct: number;
  }>(`
    SELECT
      count() as total_unified,
      countIf(resolved_at < '1971-01-01' AND resolved_at IS NOT NULL) as epoch_unified,
      round(countIf(resolved_at < '1971-01-01' AND resolved_at IS NOT NULL) * 100.0 / count(), 4) as epoch_pct
    FROM pm_trade_fifo_roi_v3_mat_unified
  `);
  return result[0];
}

async function main() {
  console.log('=== Fix Epoch Timestamp Corruption ===\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Get initial stats
  console.log('Initial stats:');
  const initialStats = await getStats();
  console.log(`  Total rows: ${initialStats.total_unified.toLocaleString()}`);
  console.log(`  Epoch timestamps: ${initialStats.epoch_unified.toLocaleString()} (${initialStats.epoch_pct}%)\n`);

  // Get corrupted conditions
  const corruptedConditions = await getCorruptedConditions();
  console.log(`Found ${corruptedConditions.length} conditions with fixable corruption\n`);

  if (corruptedConditions.length === 0) {
    console.log('No corrupted conditions found that can be fixed from v3.');
    await client.close();
    return;
  }

  // Show top 10 most affected
  console.log('Top 10 most affected conditions:');
  for (const c of corruptedConditions.slice(0, 10)) {
    console.log(`  ${c.condition_id.substring(0, 16)}... : ${c.corrupt_count.toLocaleString()} trades`);
  }
  console.log('');

  // Process in batches
  let totalFixed = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(corruptedConditions.length / BATCH_SIZE);
  const conditionIds = corruptedConditions.map(c => c.condition_id);

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    batchNum++;
    const batch = conditionIds.slice(i, i + BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches}: Processing ${batch.length} conditions...`);

    try {
      const fixed = await fixConditionBatch(batch);
      totalFixed += fixed;
      console.log(`  ✓ Fixed ${fixed.toLocaleString()} trades (total: ${totalFixed.toLocaleString()})`);
    } catch (err: any) {
      console.error(`  ✗ Error: ${err.message}`);
    }
  }

  // Optimize table
  console.log('\nOptimizing table...');
  await execute('OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL');

  // Get final stats
  console.log('\nFinal stats:');
  const finalStats = await getStats();
  console.log(`  Total rows: ${finalStats.total_unified.toLocaleString()}`);
  console.log(`  Epoch timestamps: ${finalStats.epoch_unified.toLocaleString()} (${finalStats.epoch_pct}%)`);
  console.log(`  Reduction: ${(initialStats.epoch_unified - finalStats.epoch_unified).toLocaleString()} trades fixed`);

  console.log(`\n=== Fix Complete ===`);
  console.log(`Total trades fixed: ${totalFixed.toLocaleString()}`);
  console.log(`Completed at: ${new Date().toISOString()}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
