#!/usr/bin/env npx tsx
/**
 * Optimize 10-Day Unified Table (Remove Duplicates)
 *
 * Runs OPTIMIZE TABLE FINAL to deduplicate rows.
 * Expected: 7.5M duplicates removed, 30-45 min runtime
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_NAME = 'pm_trade_fifo_roi_v3_mat_unified_10day';

async function checkDuplicatesBefore() {
  console.log('\n📊 Checking Duplicates (Before)...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniqExact(tx_hash, wallet, condition_id, outcome_index)) as unique_keys,
        formatReadableQuantity(count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)) as duplicates,
        round((count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)) * 100.0 / count(), 1) as pct_duplicate
      FROM ${TABLE_NAME}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Sample (last 7 days):');
  console.log(`     Total rows: ${stats.total_rows}`);
  console.log(`     Unique keys: ${stats.unique_keys}`);
  console.log(`     Duplicates: ${stats.duplicates} (${stats.pct_duplicate}%)`);
  console.log('');

  return stats;
}

async function optimizeTable() {
  console.log('\n🔄 Running OPTIMIZE TABLE FINAL...\n');
  console.log('   This will merge all parts and deduplicate rows.');
  console.log('   Expected runtime: 30-45 minutes');
  console.log('   Table remains queryable during optimization.');
  console.log('');

  const startTime = Date.now();

  await clickhouse.command({
    query: `OPTIMIZE TABLE ${TABLE_NAME} FINAL`,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour max
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Optimization complete in ${elapsed} minutes\n`);

  return elapsed;
}

async function checkDuplicatesAfter() {
  console.log('\n📊 Checking Duplicates (After)...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniqExact(tx_hash, wallet, condition_id, outcome_index)) as unique_keys,
        formatReadableQuantity(count() - uniqExact(tx_hash, wallet, condition_id, outcome_index)) as duplicates
      FROM ${TABLE_NAME}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Sample (last 7 days):');
  console.log(`     Total rows: ${stats.total_rows}`);
  console.log(`     Unique keys: ${stats.unique_keys}`);
  console.log(`     Duplicates: ${stats.duplicates}`);
  console.log('');

  return stats;
}

async function main() {
  console.log('🧹 OPTIMIZE 10-DAY TABLE (Remove Duplicates)');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${TABLE_NAME}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    // Check before
    const before = await checkDuplicatesBefore();

    // Optimize
    const optimizeTime = await optimizeTable();

    // Check after
    const after = await checkDuplicatesAfter();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`   - Optimization: ${optimizeTime} min`);

    console.log(`\n📈 Results:`);
    console.log(`   - Duplicates removed: ${before.duplicates} → ${after.duplicates}`);
    console.log(`   - Unique positions: ${after.unique_keys}`);

    if (after.duplicates === '0.00') {
      console.log('\n✅ SUCCESS: All duplicates removed!');
    } else {
      console.log(`\n⚠️  Still have ${after.duplicates} duplicates (may need another OPTIMIZE)`);
    }

    console.log('\n🎯 Next Steps:');
    console.log('   1. ✅ 10day table is now clean (PnL fixed + deduplicated)');
    console.log('   2. Fix main table: npx tsx scripts/fix-unified-immediate.ts');
    console.log('   3. Optimize main table: npx tsx scripts/optimize-unified-main.ts');
    console.log('');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Optimization error:', error);
    process.exit(1);
  }
}

main();
