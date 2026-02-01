#!/usr/bin/env npx tsx
/**
 * Fix BOTH Unified Tables
 *
 * Applies the same fixes to:
 * 1. pm_trade_fifo_roi_v3_mat_unified (main, 588M rows)
 * 2. pm_trade_fifo_roi_v3_mat_unified_10day (10-day copy, 183M rows)
 *
 * Fixes:
 * - Zero out PnL for unresolved positions
 * - Recalculate is_closed flag
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function fixTable(tableName: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔧 Fixing Table: ${tableName}`);
  console.log('═'.repeat(70));

  // Step 1: Fix unresolved positions
  console.log('\n1️⃣  Fixing Unresolved Positions...\n');

  const unresolvedCount = await clickhouse.query({
    query: `
      SELECT count() as count
      FROM ${tableName}
      WHERE resolved_at IS NULL
        AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)
    `,
    format: 'JSONEachRow',
  });
  const { count: unresolved_to_fix } = (await unresolvedCount.json())[0];

  console.log(`   Found ${unresolved_to_fix.toLocaleString()} unresolved positions to fix\n`);

  if (unresolved_to_fix > 0) {
    await clickhouse.command({
      query: `
        ALTER TABLE ${tableName}
        UPDATE
          pnl_usd = 0,
          exit_value = 0,
          roi = 0,
          is_closed = 0
        WHERE resolved_at IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 1800,
      },
    });
    console.log(`   ✅ Fixed ${unresolved_to_fix.toLocaleString()} unresolved positions\n`);
  } else {
    console.log('   ✅ No unresolved positions need fixing\n');
  }

  // Step 2: Fix is_closed flag
  console.log('2️⃣  Recalculating is_closed Flag...\n');

  const closedCount = await clickhouse.query({
    query: `
      SELECT
        countIf(tokens_held <= 0.01 AND is_closed = 0) +
        countIf(tokens_held > 0.01 AND is_closed = 1) as count
      FROM ${tableName}
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const { count: closed_to_fix } = (await closedCount.json())[0];

  console.log(`   Found ${closed_to_fix.toLocaleString()} positions with incorrect flag\n`);

  if (closed_to_fix > 0) {
    await clickhouse.command({
      query: `
        ALTER TABLE ${tableName}
        UPDATE is_closed = CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END
        WHERE resolved_at IS NOT NULL
      `,
      clickhouse_settings: {
        max_execution_time: 1800,
      },
    });
    console.log(`   ✅ Fixed ${closed_to_fix.toLocaleString()} is_closed flags\n`);
  } else {
    console.log('   ✅ All flags are already correct\n');
  }

  // Step 3: Verify
  console.log('3️⃣  Verifying Fixes...\n');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0)) as bad_unresolved,
        countIf(resolved_at IS NOT NULL AND
                ((tokens_held <= 0.01 AND is_closed = 0) OR
                 (tokens_held > 0.01 AND is_closed = 1))) as bad_closed_flag
      FROM ${tableName}
    `,
    format: 'JSONEachRow',
  });
  const verify = (await verifyResult.json())[0];

  if (verify.bad_unresolved === 0 && verify.bad_closed_flag === 0) {
    console.log('   ✅ All fixes verified!\n');
    return true;
  } else {
    console.log(`   ⚠️  Still have ${verify.bad_unresolved} bad unresolved, ${verify.bad_closed_flag} bad flags\n`);
    return false;
  }
}

async function main() {
  console.log('🔧 FIX BOTH UNIFIED TABLES');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  try {
    // Fix main table
    const mainSuccess = await fixTable('pm_trade_fifo_roi_v3_mat_unified');

    // Fix 10day table
    const tenDaySuccess = await fixTable('pm_trade_fifo_roi_v3_mat_unified_10day');

    console.log('\n' + '═'.repeat(70));
    console.log('📊 FINAL SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\nMain table (pm_trade_fifo_roi_v3_mat_unified): ${mainSuccess ? '✅ FIXED' : '⚠️ PARTIAL'}`);
    console.log(`10-day table (pm_trade_fifo_roi_v3_mat_unified_10day): ${tenDaySuccess ? '✅ FIXED' : '⚠️ PARTIAL'}`);
    console.log('\nNext steps:');
    console.log('1. Run OPTIMIZE TABLE on both tables tonight to remove duplicates');
    console.log('2. Monitor data quality over next few days');
    console.log('3. Consider dropping 10day table if not needed\n');

    process.exit(mainSuccess && tenDaySuccess ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Fix error:', error);
    process.exit(1);
  }
}

main();
