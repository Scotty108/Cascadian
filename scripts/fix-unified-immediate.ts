#!/usr/bin/env npx tsx
/**
 * Immediate Fixes for Unified Table
 *
 * Fixes the most critical issues:
 * 1. Zero out PnL for unresolved positions (they shouldn't have PnL)
 * 2. Recalculate is_closed flag based on tokens_held
 *
 * Runtime: ~30-40 minutes
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function fixUnresolvedPnL() {
  console.log('\n1️⃣  Fixing Unresolved Positions (zeroing PnL)...\n');
  console.log('   This will set pnl_usd = 0, exit_value = 0, roi = 0, is_closed = 0');
  console.log('   for all positions where resolved_at IS NULL\n');

  const startTime = Date.now();

  // Count positions to fix
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as positions_to_fix
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
        AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)
    `,
    format: 'JSONEachRow',
  });
  const { positions_to_fix } = (await countResult.json())[0];

  console.log(`   Found ${positions_to_fix.toLocaleString()} positions to fix\n`);

  if (positions_to_fix === 0) {
    console.log('   ✅ No positions need fixing!\n');
    return;
  }

  // Apply fix
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      UPDATE
        pnl_usd = 0,
        exit_value = 0,
        roi = 0,
        is_closed = 0
      WHERE resolved_at IS NULL
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 minutes
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Fixed ${positions_to_fix.toLocaleString()} unresolved positions in ${elapsed} minutes\n`);
}

async function fixIsClosedFlag() {
  console.log('\n2️⃣  Recalculating is_closed Flag...\n');
  console.log('   Setting is_closed = 1 where tokens_held <= 0.01');
  console.log('   Setting is_closed = 0 where tokens_held > 0.01\n');

  const startTime = Date.now();

  // Count positions with wrong flag
  const countResult = await clickhouse.query({
    query: `
      SELECT
        countIf(tokens_held <= 0.01 AND is_closed = 0) as should_be_closed,
        countIf(tokens_held > 0.01 AND is_closed = 1) as should_be_open
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const wrong = (await countResult.json())[0];

  const total_wrong = wrong.should_be_closed + wrong.should_be_open;
  console.log(`   Found ${total_wrong.toLocaleString()} positions with incorrect flag`);
  console.log(`     - ${wrong.should_be_closed.toLocaleString()} should be closed`);
  console.log(`     - ${wrong.should_be_open.toLocaleString()} should be open\n`);

  if (total_wrong === 0) {
    console.log('   ✅ All flags are already correct!\n');
    return;
  }

  // Apply fix
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      UPDATE is_closed = CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END
      WHERE resolved_at IS NOT NULL
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 minutes
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Fixed ${total_wrong.toLocaleString()} position flags in ${elapsed} minutes\n`);
}

async function verifyFixes() {
  console.log('\n3️⃣  Verifying Fixes...\n');

  // Verify unresolved positions
  const unresolvedResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_unresolved,
        countIf(pnl_usd != 0) as with_pnl,
        countIf(exit_value != 0) as with_exit_value,
        countIf(is_closed = 1) as marked_closed
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
    `,
    format: 'JSONEachRow',
  });
  const unresolved = (await unresolvedResult.json())[0];

  console.log('   Unresolved Positions:');
  console.log(`     Total: ${unresolved.total_unresolved.toLocaleString()}`);
  console.log(`     With non-zero PnL: ${unresolved.with_pnl.toLocaleString()}`);
  console.log(`     With non-zero exit_value: ${unresolved.with_exit_value.toLocaleString()}`);
  console.log(`     Marked closed: ${unresolved.marked_closed.toLocaleString()}`);

  if (unresolved.with_pnl === 0 && unresolved.with_exit_value === 0 && unresolved.marked_closed === 0) {
    console.log('   ✅ All unresolved positions are clean!\n');
  } else {
    console.log('   ⚠️  Some unresolved positions still have issues\n');
  }

  // Verify is_closed flag
  const closedResult = await clickhouse.query({
    query: `
      SELECT
        countIf(tokens_held <= 0.01 AND is_closed = 0) as should_be_closed,
        countIf(tokens_held > 0.01 AND is_closed = 1) as should_be_open
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const closed = (await closedResult.json())[0];

  console.log('   is_closed Flag:');
  console.log(`     Positions that should be closed but aren't: ${closed.should_be_closed.toLocaleString()}`);
  console.log(`     Positions that should be open but aren't: ${closed.should_be_open.toLocaleString()}`);

  if (closed.should_be_closed === 0 && closed.should_be_open === 0) {
    console.log('   ✅ All is_closed flags are correct!\n');
  } else {
    console.log('   ⚠️  Some flags are still incorrect\n');
  }
}

async function main() {
  console.log('🔧 IMMEDIATE UNIFIED TABLE FIXES');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  try {
    await fixUnresolvedPnL();
    await fixIsClosedFlag();
    await verifyFixes();

    console.log('═'.repeat(70));
    console.log('✅ IMMEDIATE FIXES COMPLETE');
    console.log('═'.repeat(70));
    console.log('\nNext steps:');
    console.log('1. Run OPTIMIZE TABLE tonight to remove duplicates');
    console.log('2. Monitor data quality over next few days');
    console.log('3. Consider full rebuild if issues persist\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fix error:', error);
    process.exit(1);
  }
}

main();
