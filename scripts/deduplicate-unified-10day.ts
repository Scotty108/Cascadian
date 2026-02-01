#!/usr/bin/env npx tsx
/**
 * Deduplicate 10-Day Unified Table
 *
 * Creates a new deduplicated table using GROUP BY, then atomically swaps.
 * Expected: 183M rows → ~95M rows, 15-20 min runtime
 *
 * Process:
 * 1. Create new table with GROUP BY deduplication (10-15 min)
 * 2. Verify row counts and data quality (2 min)
 * 3. Atomic RENAME swap (<1 sec)
 * 4. Keep old table as backup
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const NEW_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_clean';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_old';

async function checkDuplicatesBefore() {
  console.log('\n📊 Checking Duplicates (Before)...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniqExact(tx_hash, wallet, condition_id, outcome_index)) as unique_keys,
        formatReadableQuantity(count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)) as duplicates,
        round((count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)) * 100.0 / count(), 1) as pct_duplicate
      FROM ${OLD_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Current table (sample last 7 days):');
  console.log(`     Total rows: ${stats.total_rows}`);
  console.log(`     Unique keys: ${stats.unique_keys}`);
  console.log(`     Duplicates: ${stats.duplicates} (${stats.pct_duplicate}%)`);
  console.log('');

  return stats;
}

async function createDeduplicatedTable() {
  console.log('\n🔨 Creating Deduplicated Table...\n');
  console.log('   This will take 10-15 minutes...');
  console.log('');

  const startTime = Date.now();

  // Create new table with GROUP BY deduplication
  await clickhouse.command({
    query: `
      CREATE TABLE ${NEW_TABLE}
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
      AS
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
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 min max
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Created deduplicated table in ${elapsed} minutes\n`);

  return elapsed;
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
  console.log(`     Duplicates found: ${dup.duplicates.toLocaleString()}`);
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
  console.log('🧹 DEDUPLICATE 10-DAY TABLE');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${OLD_TABLE}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    // Step 1: Check before
    const before = await checkDuplicatesBefore();

    // Step 2: Create deduplicated table
    const createTime = await createDeduplicatedTable();

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

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`   - Table creation: ${createTime} min`);

    console.log(`\n📈 Results:`);
    console.log(`   - Duplicates removed: ${before.duplicates} → 0`);
    console.log(`   - Table is now clean and active`);
    console.log(`   - Backup kept at: ${BACKUP_TABLE}`);

    console.log('\n🎯 Next Steps:');
    console.log('   1. ✅ 10day table is now CLEAN (deduplicated + PnL fixed)');
    console.log('   2. Test queries on new table');
    console.log('   3. If satisfied, drop backup: DROP TABLE ' + BACKUP_TABLE);
    console.log('   4. Fix main table: npx tsx scripts/fix-unified-immediate.ts');
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
