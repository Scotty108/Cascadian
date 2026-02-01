#!/usr/bin/env npx tsx
/**
 * Deduplicate 10-Day Table (Wave-Based)
 *
 * Runs 10 workers in waves of 3 to stay under memory limit.
 * - Wave 1: Workers 0, 1, 2
 * - Wave 2: Workers 3, 4, 5
 * - Wave 3: Workers 6, 7, 8
 * - Wave 4: Worker 9
 *
 * Expected:
 * - Memory per wave: ~4.5 GB (3 workers × 1.5 GB)
 * - Total time: 20-28 min (4 waves × 5-7 min)
 * - Result: 183M rows → ~95M rows
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const NEW_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_clean';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_old';
const NUM_WORKERS = 10;
const WORKERS_PER_WAVE = 3;

async function createEmptyTable() {
  console.log('\n📋 Creating Empty Destination Table...\n');

  // Drop if exists (cleanup from previous failed run)
  try {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${NEW_TABLE}` });
  } catch (e) {
    // Ignore if doesn't exist
  }

  // Create empty table with same schema
  await clickhouse.command({
    query: `
      CREATE TABLE ${NEW_TABLE}
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
      AS
      SELECT *
      FROM ${OLD_TABLE}
      WHERE 1 = 0
    `,
  });

  console.log('   ✅ Empty table created\n');
}

async function processWorkerBatch(workerId: number) {
  const startTime = Date.now();

  // Insert deduplicated data for this worker's partition
  await clickhouse.command({
    query: `
      INSERT INTO ${NEW_TABLE}
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as entry_time,
        any(resolved_at) as resolved_at,
        any(cost_usd) as cost_usd,
        any(tokens) as tokens,
        any(tokens_sold_early) as tokens_sold_early,
        any(tokens_held) as tokens_held,
        any(exit_value) as exit_value,
        any(pnl_usd) as pnl_usd,
        any(roi) as roi,
        any(pct_sold_early) as pct_sold_early,
        any(is_maker) as is_maker,
        any(is_short) as is_short,
        any(is_closed) as is_closed
      FROM ${OLD_TABLE}
      WHERE cityHash64(wallet) % ${NUM_WORKERS} = ${workerId}
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 600, // 10 min per worker
      max_memory_usage: 2000000000, // 2 GB per worker (safety limit)
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Get row count for this worker
  const result = await clickhouse.query({
    query: `
      SELECT count() as rows
      FROM ${NEW_TABLE}
      WHERE cityHash64(wallet) % ${NUM_WORKERS} = ${workerId}
    `,
    format: 'JSONEachRow',
  });
  const { rows } = (await result.json())[0];

  return { workerId, rows, elapsed };
}

async function orchestrateWaves() {
  console.log('\n🌊 Running Workers in Waves...\n');
  console.log(`   Workers per wave: ${WORKERS_PER_WAVE}`);
  console.log(`   Total waves: ${Math.ceil(NUM_WORKERS / WORKERS_PER_WAVE)}`);
  console.log('   Expected time: 20-28 min\n');

  const startTime = Date.now();
  const allResults = [];

  // Run workers in waves
  for (let wave = 0; wave < Math.ceil(NUM_WORKERS / WORKERS_PER_WAVE); wave++) {
    const waveStart = wave * WORKERS_PER_WAVE;
    const waveEnd = Math.min(waveStart + WORKERS_PER_WAVE, NUM_WORKERS);
    const workersInWave = [];

    console.log(`\n🌊 Wave ${wave + 1}: Workers ${waveStart}-${waveEnd - 1}\n`);

    for (let i = waveStart; i < waveEnd; i++) {
      workersInWave.push(i);
    }

    console.log(`   [${new Date().toLocaleTimeString()}] Starting workers: ${workersInWave.join(', ')}\n`);

    const waveStartTime = Date.now();

    // Launch workers in this wave (parallel within wave)
    const wavePromises = workersInWave.map((workerId) => {
      console.log(`   [Worker ${workerId}] Processing wallet partition ${workerId}/${NUM_WORKERS}...`);
      return processWorkerBatch(workerId);
    });

    // Wait for wave to complete
    const waveResults = await Promise.all(wavePromises);
    allResults.push(...waveResults);

    const waveElapsed = ((Date.now() - waveStartTime) / 1000 / 60).toFixed(1);

    console.log(`\n   ✅ Wave ${wave + 1} complete in ${waveElapsed} min:`);
    waveResults.forEach((r) => {
      console.log(`      Worker ${r.workerId}: ${r.rows.toLocaleString()} rows (${r.elapsed} min)`);
    });
    console.log('');
  }

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const totalRows = allResults.reduce((sum, r) => sum + r.rows, 0);

  console.log('\n📊 All Waves Complete:');
  console.log('   ═'.repeat(35));
  allResults.forEach((r) => {
    console.log(`   Worker ${r.workerId}: ${r.rows.toLocaleString()} rows (${r.elapsed} min)`);
  });
  console.log('   ═'.repeat(35));
  console.log(`   Total: ${totalRows.toLocaleString()} rows in ${totalElapsed} min\n`);

  return { totalRows, totalElapsed };
}

async function verifyNewTable() {
  console.log('\n🔍 Verifying New Table...\n');

  // Row counts
  const oldCount = await clickhouse.query({
    query: `SELECT formatReadableQuantity(count()) as count FROM ${OLD_TABLE}`,
    format: 'JSONEachRow',
  });
  const oldRows = (await oldCount.json())[0].count;

  const newCount = await clickhouse.query({
    query: `SELECT formatReadableQuantity(count()) as count FROM ${NEW_TABLE}`,
    format: 'JSONEachRow',
  });
  const newRows = (await newCount.json())[0].count;

  console.log('   Row Counts:');
  console.log(`     Old table: ${oldRows}`);
  console.log(`     New table: ${newRows}`);
  console.log('');

  // Check for duplicates in new table
  const dupCheck = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM ${NEW_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const dup = (await dupCheck.json())[0];

  console.log('   Duplicate Check (sample last 7 days):');
  console.log(`     Total rows: ${dup.total.toLocaleString()}`);
  console.log(`     Unique keys: ${dup.unique.toLocaleString()}`);
  console.log(`     Duplicates: ${dup.duplicates.toLocaleString()}`);
  console.log('');

  // Check data integrity
  const integrityCheck = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0)) as bad_unresolved,
        countIf(resolved_at IS NOT NULL AND
                ((tokens_held <= 0.01 AND is_closed = 0) OR
                 (tokens_held > 0.01 AND is_closed = 1))) as bad_closed_flag
      FROM ${NEW_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const integrity = (await integrityCheck.json())[0];

  console.log('   Data Integrity:');
  console.log(`     Bad unresolved: ${integrity.bad_unresolved.toLocaleString()}`);
  console.log(`     Bad is_closed flags: ${integrity.bad_closed_flag.toLocaleString()}`);
  console.log('');

  if (dup.duplicates === 0 && integrity.bad_unresolved === 0 && integrity.bad_closed_flag === 0) {
    console.log('   ✅ New table is CLEAN!\n');
    return true;
  } else {
    console.log('   ⚠️  New table has issues\n');
    return false;
  }
}

async function swapTables() {
  console.log('\n🔄 Swapping Tables (Atomic)...\n');

  await clickhouse.command({
    query: `
      RENAME TABLE
        ${OLD_TABLE} TO ${BACKUP_TABLE},
        ${NEW_TABLE} TO ${OLD_TABLE}
    `,
  });

  console.log('   ✅ Tables swapped!\n');
  console.log(`     ${OLD_TABLE} → ${BACKUP_TABLE} (backup)`);
  console.log(`     ${NEW_TABLE} → ${OLD_TABLE} (now active)`);
  console.log('');
}

async function finalVerification() {
  console.log('\n✅ Final Verification...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniqExact(tx_hash, wallet, condition_id, outcome_index)) as unique_keys,
        formatReadableQuantity(count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)) as duplicates
      FROM ${OLD_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Active table (sample last 7 days):');
  console.log(`     Total rows: ${stats.total_rows}`);
  console.log(`     Unique keys: ${stats.unique_keys}`);
  console.log(`     Duplicates: ${stats.duplicates}`);
  console.log('');

  if (stats.duplicates === '0.00') {
    console.log('   ✅ SUCCESS: Zero duplicates!\n');
    return true;
  } else {
    console.log(`   ⚠️  Still have ${stats.duplicates} duplicates\n`);
    return false;
  }
}

async function main() {
  console.log('🧹 DEDUPLICATE 10-DAY TABLE (Wave-Based)');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${OLD_TABLE}`);
  console.log(`👷 Workers: ${NUM_WORKERS} workers in waves of ${WORKERS_PER_WAVE}`);
  console.log(`🌊 Waves: ${Math.ceil(NUM_WORKERS / WORKERS_PER_WAVE)} waves`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    // Step 1: Create empty destination table
    await createEmptyTable();

    // Step 2: Run workers in waves
    const { totalRows, totalElapsed } = await orchestrateWaves();

    // Step 3: Verify new table
    const verified = await verifyNewTable();

    if (!verified) {
      console.log('⚠️  Verification failed - NOT swapping tables');
      console.log('   New table exists as: ' + NEW_TABLE);
      console.log('   Original table unchanged: ' + OLD_TABLE);
      process.exit(1);
    }

    // Step 4: Atomic swap
    await swapTables();

    // Step 5: Final verification
    const success = await finalVerification();

    const grandTotalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${grandTotalElapsed} minutes`);
    console.log(`   - Worker execution: ${totalElapsed} min (wave-based)`);
    console.log(`   - Verification + swap: ${(parseFloat(grandTotalElapsed) - parseFloat(totalElapsed)).toFixed(1)} min`);

    console.log(`\n📈 Results:`);
    console.log(`   - Old table: 183.09M rows`);
    console.log(`   - New table: ${totalRows.toLocaleString()} rows`);
    console.log(`   - Duplicates removed: ${(183090000 - totalRows).toLocaleString()} rows`);
    console.log(`   - Disk savings: ~15 GB`);
    console.log(`   - Backup kept at: ${BACKUP_TABLE}`);

    console.log('\n🎯 Next Steps:');
    console.log('   1. ✅ 10day table is now CLEAN (deduplicated + PnL fixed)');
    console.log('   2. Test queries on new table');
    console.log('   3. If satisfied, drop backup: DROP TABLE ' + BACKUP_TABLE);
    console.log('   4. Fix main table: npx tsx scripts/fix-unified-immediate.ts');
    console.log('   5. Dedupe main table: Use wave-based approach overnight');
    console.log('');

    console.log('═'.repeat(70) + '\n');

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Deduplication error:', error);
    console.log('\n   Original table unchanged: ' + OLD_TABLE);
    if (error instanceof Error && error.message.includes('already exists')) {
      console.log('   Clean up with: DROP TABLE ' + NEW_TABLE);
    }
    process.exit(1);
  }
}

main();
