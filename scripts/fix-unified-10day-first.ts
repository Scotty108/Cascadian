#!/usr/bin/env npx tsx
/**
 * Fix 10day Table FIRST (Test Run)
 *
 * Fixes the smaller pm_trade_fifo_roi_v3_mat_unified_10day table first:
 * 1. Zero out PnL for unresolved positions
 * 2. Recalculate is_closed flag
 *
 * This is a test run before fixing the main table.
 * Runtime: ~15-20 minutes (vs 30-40 for main table)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_NAME = 'pm_trade_fifo_roi_v3_mat_unified_10day';

async function analyzeWorkload() {
  console.log('\n📊 Analyzing Workload...\n');

  const workloadResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1))) as unresolved_to_fix,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL AND
                  ((tokens_held <= 0.01 AND is_closed = 0) OR
                   (tokens_held > 0.01 AND is_closed = 1)))) as flags_to_fix
      FROM ${TABLE_NAME}
    `,
    format: 'JSONEachRow',
  });
  const workload = (await workloadResult.json())[0];

  console.log(`   Table: ${TABLE_NAME}`);
  console.log(`   Total rows: ${workload.total_rows}`);
  console.log(`   Unresolved positions to fix: ${workload.unresolved_to_fix}`);
  console.log(`   is_closed flags to fix: ${workload.flags_to_fix}`);
  console.log('');

  return workload;
}

async function fixUnresolvedPnL() {
  console.log('\n1️⃣  Fixing Unresolved Positions (zeroing PnL)...\n');

  const startTime = Date.now();

  await clickhouse.command({
    query: `
      ALTER TABLE ${TABLE_NAME}
      UPDATE
        pnl_usd = 0,
        exit_value = 0,
        roi = 0,
        is_closed = 0
      WHERE resolved_at IS NULL
        AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 minutes max
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Fixed unresolved positions in ${elapsed} minutes\n`);

  return elapsed;
}

async function fixIsClosedFlag() {
  console.log('\n2️⃣  Recalculating is_closed Flag...\n');

  const startTime = Date.now();

  await clickhouse.command({
    query: `
      ALTER TABLE ${TABLE_NAME}
      UPDATE is_closed = CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END
      WHERE resolved_at IS NOT NULL
        AND ((tokens_held <= 0.01 AND is_closed = 0) OR
             (tokens_held > 0.01 AND is_closed = 1))
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 minutes max
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Fixed is_closed flags in ${elapsed} minutes\n`);

  return elapsed;
}

async function verifyFixes() {
  console.log('\n3️⃣  Verifying Fixes...\n');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)) as bad_unresolved,
        countIf(resolved_at IS NOT NULL AND
                ((tokens_held <= 0.01 AND is_closed = 0) OR
                 (tokens_held > 0.01 AND is_closed = 1))) as bad_closed_flag
      FROM ${TABLE_NAME}
    `,
    format: 'JSONEachRow',
  });
  const verify = (await verifyResult.json())[0];

  console.log('   Verification Results:');
  console.log(`     Bad unresolved positions: ${verify.bad_unresolved.toLocaleString()}`);
  console.log(`     Bad is_closed flags: ${verify.bad_closed_flag.toLocaleString()}`);
  console.log('');

  if (verify.bad_unresolved === 0 && verify.bad_closed_flag === 0) {
    console.log('   ✅ ALL FIXES VERIFIED - Table is clean!\n');
    return true;
  } else {
    console.log('   ⚠️  Some issues remain\n');
    return false;
  }
}

async function main() {
  console.log('🧪 FIX 10-DAY TABLE FIRST (Test Run)');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Table: ${TABLE_NAME}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    // Analyze
    const workload = await analyzeWorkload();

    // Fix unresolved
    const unresolvedTime = await fixUnresolvedPnL();

    // Fix is_closed
    const closedTime = await fixIsClosedFlag();

    // Verify
    const success = await verifyFixes();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`   - Unresolved fix: ${unresolvedTime} min`);
    console.log(`   - is_closed fix: ${closedTime} min`);
    console.log(`\n${success ? '✅' : '⚠️'}  Status: ${success ? 'SUCCESS' : 'PARTIAL'}`);

    if (success) {
      console.log('\n🎯 Next Steps:');
      console.log('   1. ✅ 10day table is clean and ready to use!');
      console.log('   2. Now fix main table: npx tsx scripts/fix-unified-immediate.ts');
      console.log('   3. Expected time for main: ~' + (parseFloat(totalElapsed) * 1.6).toFixed(0) + ' minutes');
      console.log('');
    } else {
      console.log('\n⚠️  Some issues remain - investigate before fixing main table');
      console.log('');
    }

    console.log('═'.repeat(70) + '\n');

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Fix error:', error);
    process.exit(1);
  }
}

main();
