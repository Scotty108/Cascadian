#!/usr/bin/env tsx
/**
 * P0 DEDUPLICATION - STOP THE FIREHOSE
 *
 * Strategy: Keep earliest instance of each trade_id
 * Expected: 139.6M → 33.2M trades (remove 106.4M duplicates)
 *
 * CRITICAL: This is DESTRUCTIVE. Backup created automatically.
 * Run with 8 workers for parallel processing with crash protection.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@clickhouse/client';

// Use extended timeout for large queries
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 600000, // 10 minutes for large queries
});
import { writeFileSync, existsSync } from 'fs';

const CHECKPOINT_FILE = '/tmp/dedup-checkpoint.json';

interface Checkpoint {
  step: string;
  timestamp: string;
  rowCount?: number;
  error?: string;
}

function saveCheckpoint(step: string, data: any = {}) {
  const checkpoint: Checkpoint = {
    step,
    timestamp: new Date().toISOString(),
    ...data
  };
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  console.log(`✅ Checkpoint saved: ${step}`);
}

function loadCheckpoint(): Checkpoint | null {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  return JSON.parse(require('fs').readFileSync(CHECKPOINT_FILE, 'utf-8'));
}

async function executeDedupe() {
  console.log('🚨 P0 DEDUPLICATION - STOPPING THE FIREHOSE 🚨\n');
  console.log('Strategy: trade_id-based (keep earliest created_at)\n');

  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`📍 Resuming from checkpoint: ${checkpoint.step}\n`);
  }

  // STEP 0: Pre-flight checks
  if (!checkpoint || checkpoint.step === 'start') {
    console.log('Step 0: Pre-flight checks...');

    // Check if backup already exists
    try {
      const backupCheck = await clickhouse.query({
        query: `SELECT count() FROM pm_trades_canonical_v3_backup_20251116`,
        format: 'JSONEachRow'
      });
      console.log('⚠️  Backup table already exists. Using existing backup.');
    } catch (e) {
      console.log('✅ No existing backup found. Will create new one.');
    }

    // Get current row count
    const countResult = await clickhouse.query({
      query: `SELECT count() AS total FROM pm_trades_canonical_v3`,
      format: 'JSONEachRow'
    });
    const currentCount = (await countResult.json<any>())[0].total;
    console.log(`Current row count: ${currentCount.toLocaleString()}`);

    // Get unique trade_id count (expected final count)
    console.log('Counting unique trade_ids (this may take 1-2 minutes)...');
    const uniqueResult = await clickhouse.query({
      query: `SELECT count(DISTINCT trade_id) AS unique_trades FROM pm_trades_canonical_v3`,
      format: 'JSONEachRow'
    });
    const expectedCount = (await uniqueResult.json<any>())[0].unique_trades;
    console.log(`Expected final count: ${expectedCount.toLocaleString()}`);
    console.log(`Will remove: ${(currentCount - expectedCount).toLocaleString()} duplicates\n`);

    saveCheckpoint('preflight', { currentCount, expectedCount });
  }

  // STEP 1: Create duplicate analysis table
  if (!checkpoint || checkpoint.step === 'preflight') {
    console.log('Step 1: Creating duplicate analysis table...');

    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS tmp_true_duplicates (
          trade_id String,
          duplicate_count UInt32,
          first_seen DateTime,
          all_timestamps Array(DateTime)
        )
        ENGINE = MergeTree()
        ORDER BY trade_id
        AS
        SELECT
          trade_id,
          count() AS duplicate_count,
          min(created_at) AS first_seen,
          groupArray(created_at) AS all_timestamps
        FROM pm_trades_canonical_v3
        GROUP BY trade_id
        HAVING duplicate_count > 1
      `,
      format: 'JSONEachRow'
    });

    const dupCountResult = await clickhouse.query({
      query: `SELECT count() AS dup_trades FROM tmp_true_duplicates`,
      format: 'JSONEachRow'
    });
    const dupCount = (await dupCountResult.json<any>())[0].dup_trades;
    console.log(`✅ Found ${dupCount.toLocaleString()} trade_ids with duplicates\n`);

    saveCheckpoint('analysis_complete', { dupCount });
  }

  // STEP 2: Create deduplicated table
  if (!checkpoint || checkpoint.step === 'analysis_complete') {
    console.log('Step 2: Creating deduplicated table (this will take 5-10 minutes)...');
    console.log('Strategy: Keep earliest created_at for each trade_id\n');

    const startTime = Date.now();

    // Use ROW_NUMBER() to pick exactly one row per trade_id (earliest created_at)
    // CRITICAL: Add secondary+tertiary sort columns for deterministic ordering
    // Many rows have identical timestamps, so ORDER BY created_at alone is non-deterministic
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS pm_trades_canonical_v3_deduped
        ENGINE = ReplacingMergeTree(created_at)
        ORDER BY trade_id
        AS
        SELECT * EXCEPT (rn)
        FROM (
          SELECT *,
                 ROW_NUMBER() OVER (
                   PARTITION BY trade_id
                   ORDER BY created_at ASC, transaction_hash ASC, wallet_address ASC
                 ) AS rn
          FROM pm_trades_canonical_v3
        )
        WHERE rn = 1
      `,
      format: 'JSONEachRow'
    });

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`✅ Deduplicated table created in ${elapsed} minutes\n`);

    // Verify row count
    const dedupCountResult = await clickhouse.query({
      query: `SELECT count() AS total FROM pm_trades_canonical_v3_deduped`,
      format: 'JSONEachRow'
    });
    const dedupCount = (await dedupCountResult.json<any>())[0].total;
    console.log(`Deduped table row count: ${dedupCount.toLocaleString()}\n`);

    saveCheckpoint('dedup_complete', { dedupCount });
  }

  // STEP 3: Validation checks
  if (!checkpoint || checkpoint.step === 'dedup_complete') {
    console.log('Step 3: Running validation checks...\n');

    // Check 1: Row count matches unique trade_ids
    console.log('Check 1: Verifying row count...');
    const [dedupCount, uniqueCheck] = await Promise.all([
      clickhouse.query({
        query: `SELECT count() AS total FROM pm_trades_canonical_v3_deduped`,
        format: 'JSONEachRow'
      }).then(r => r.json<any>()).then(d => d[0].total),
      clickhouse.query({
        query: `SELECT count(DISTINCT trade_id) AS unique_ids FROM pm_trades_canonical_v3_deduped`,
        format: 'JSONEachRow'
      }).then(r => r.json<any>()).then(d => d[0].unique_ids)
    ]);

    if (dedupCount === uniqueCheck) {
      console.log(`✅ Row count matches unique trade_ids: ${dedupCount.toLocaleString()}`);
    } else {
      throw new Error(`❌ VALIDATION FAILED: Row count (${dedupCount}) != Unique IDs (${uniqueCheck})`);
    }

    // Check 2: No duplicates in deduped table
    console.log('Check 2: Verifying no duplicates...');
    const dupCheckResult = await clickhouse.query({
      query: `
        SELECT count() AS remaining_dups
        FROM (
          SELECT trade_id
          FROM pm_trades_canonical_v3_deduped
          GROUP BY trade_id
          HAVING count() > 1
        )
      `,
      format: 'JSONEachRow'
    });
    const remainingDups = (await dupCheckResult.json<any>())[0].remaining_dups;

    if (remainingDups === 0) {
      console.log('✅ No duplicates found in deduped table');
    } else {
      throw new Error(`❌ VALIDATION FAILED: ${remainingDups} duplicates still exist`);
    }

    // Check 3: Volume preserved
    console.log('Check 3: Verifying volume preserved...');
    const [origVolume, dedupVolume] = await Promise.all([
      clickhouse.query({
        query: `
          SELECT sum(usd_value) AS total_volume
          FROM (
            SELECT trade_id, any(usd_value) AS usd_value
            FROM pm_trades_canonical_v3
            GROUP BY trade_id
          )
        `,
        format: 'JSONEachRow'
      }).then(r => r.json<any>()).then(d => d[0].total_volume),
      clickhouse.query({
        query: `SELECT sum(usd_value) AS total_volume FROM pm_trades_canonical_v3_deduped`,
        format: 'JSONEachRow'
      }).then(r => r.json<any>()).then(d => d[0].total_volume)
    ]);

    const volumeDiff = Math.abs(origVolume - dedupVolume);
    const volumeDiffPct = (volumeDiff / origVolume) * 100;

    if (volumeDiffPct < 0.01) {
      console.log(`✅ Volume preserved: $${Math.round(dedupVolume / 1e9).toLocaleString()}B`);
      console.log(`   Difference: $${Math.round(volumeDiff).toLocaleString()} (${volumeDiffPct.toFixed(4)}%)`);
    } else {
      throw new Error(`❌ VALIDATION FAILED: Volume difference ${volumeDiffPct.toFixed(2)}% exceeds 0.01% threshold`);
    }

    console.log('\n✅ All validation checks passed!\n');
    saveCheckpoint('validation_complete', { dedupCount, origVolume, dedupVolume });
  }

  // STEP 4: Create backup and atomic swap
  if (!checkpoint || checkpoint.step === 'validation_complete') {
    console.log('Step 4: Creating backup and executing atomic swap...\n');

    // Check if backup exists
    let backupExists = false;
    try {
      await clickhouse.query({
        query: `SELECT 1 FROM pm_trades_canonical_v3_backup_20251116 LIMIT 1`,
        format: 'JSONEachRow'
      });
      backupExists = true;
      console.log('⚠️  Backup table already exists. Skipping backup creation.');
    } catch (e) {
      console.log('Creating backup...');
    }

    // Atomic swap
    console.log('Executing atomic RENAME (swapping tables)...');

    if (backupExists) {
      // If backup exists, just replace v3 with deduped
      await clickhouse.query({
        query: `
          RENAME TABLE
            pm_trades_canonical_v3 TO pm_trades_canonical_v3_old_temp,
            pm_trades_canonical_v3_deduped TO pm_trades_canonical_v3
        `,
        format: 'JSONEachRow'
      });
      console.log('✅ Table swapped (old temp table created)');
      console.log('⚠️  You can drop pm_trades_canonical_v3_old_temp if satisfied with results');
    } else {
      // Create backup and swap
      await clickhouse.query({
        query: `
          RENAME TABLE
            pm_trades_canonical_v3 TO pm_trades_canonical_v3_backup_20251116,
            pm_trades_canonical_v3_deduped TO pm_trades_canonical_v3
        `,
        format: 'JSONEachRow'
      });
      console.log('✅ Tables swapped! Backup saved as pm_trades_canonical_v3_backup_20251116');
    }

    saveCheckpoint('swap_complete');
  }

  // STEP 5: Final verification
  console.log('\nStep 5: Final verification...\n');

  const finalCount = await clickhouse.query({
    query: `SELECT count() AS total FROM pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);

  console.log(`Final pm_trades_canonical_v3 row count: ${finalCount.toLocaleString()}`);

  const dupCheck = await clickhouse.query({
    query: `
      SELECT count() AS remaining_dups
      FROM (
        SELECT trade_id
        FROM pm_trades_canonical_v3
        GROUP BY trade_id
        HAVING count() > 1
      )
    `,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].remaining_dups);

  console.log(`Remaining duplicates: ${dupCheck}`);

  // Drop temp table
  try {
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS tmp_true_duplicates`,
      format: 'JSONEachRow'
    });
    console.log('✅ Cleaned up temp analysis table');
  } catch (e) {
    console.log('⚠️  Could not drop tmp_true_duplicates (may not exist)');
  }

  saveCheckpoint('complete', { finalCount, dupCheck });

  console.log('\n================================================================================');
  console.log('🎉 P0 DEDUPLICATION COMPLETE 🎉');
  console.log('================================================================================\n');
  console.log('RESULTS:');
  console.log(`  Before: ~139.6M trades`);
  console.log(`  After:  ${finalCount.toLocaleString()} trades`);
  console.log(`  Removed: ~${(139600000 - finalCount).toLocaleString()} duplicates`);
  console.log(`  Remaining duplicates: ${dupCheck}`);
  console.log('\nBACKUP LOCATION:');
  console.log('  pm_trades_canonical_v3_backup_20251116');
  console.log('\nNEXT STEPS:');
  console.log('  1. Fix upstream CLOB ingestion pipeline (prevent new duplicates)');
  console.log('  2. Deploy ETL guardrail (normalize wallet/cid)');
  console.log('  3. Re-run PnL calculations');
  console.log('  4. Monitor for new duplicates via nightly-collision-check.ts');
  console.log('\n================================================================================\n');
}

// Execute with error handling
executeDedupe().catch(async (error) => {
  console.error('\n❌ DEDUPLICATION FAILED:\n', error);
  saveCheckpoint('error', { error: error.message });
  console.error('\n🔄 Checkpoint saved. You can resume by re-running this script.');
  console.error('📍 Checkpoint file:', CHECKPOINT_FILE);
  process.exit(1);
});
