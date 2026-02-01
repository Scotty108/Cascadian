#!/usr/bin/env npx tsx
/**
 * Fix Main Unified Table
 *
 * Applies the same fixes to pm_trade_fifo_roi_v3_mat_unified:
 * 1. Zero out PnL for unresolved positions
 * 2. Recalculate is_closed flag
 *
 * Expected runtime: 35-40 minutes
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE_NAME = 'pm_trade_fifo_roi_v3_mat_unified';

async function analyzeWorkload() {
  console.log('\n📊 Analyzing Workload...\n');

  const workloadResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(sum(rows)) as total_rows
      FROM system.parts
      WHERE table = '${TABLE_NAME}' AND active
    `,
    format: 'JSONEachRow',
  });
  const workload = (await workloadResult.json())[0];

  // Count positions to fix (sample to avoid timeout)
  const unresolvedResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as unresolved_to_fix
      FROM ${TABLE_NAME}
      WHERE resolved_at IS NULL
        AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)
      LIMIT 20000000
    `,
    format: 'JSONEachRow',
  });
  const unresolved = (await unresolvedResult.json())[0];

  console.log(`   Table: ${TABLE_NAME}`);
  console.log(`   Total rows: ${workload.total_rows}`);
  console.log(`   Unresolved positions to fix: ${unresolved.unresolved_to_fix} (sample)`);
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
      max_execution_time: 3600, // 60 minutes max
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Mutation submitted in ${elapsed} minutes`);
  console.log(`   ⏳ Mutation is running in background (check system.mutations)\n`);

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
      max_execution_time: 3600, // 60 minutes max
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Mutation submitted in ${elapsed} minutes`);
  console.log(`   ⏳ Mutation is running in background (check system.mutations)\n`);

  return elapsed;
}

async function checkMutationStatus() {
  console.log('\n3️⃣  Checking Mutation Status...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        command,
        create_time,
        is_done,
        parts_to_do,
        parts_to_do_names,
        latest_fail_reason
      FROM system.mutations
      WHERE table = '${TABLE_NAME}'
      ORDER BY create_time DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const mutations = await result.json();

  if (mutations.length === 0) {
    console.log('   No mutations found (all complete or none started)\n');
    return true;
  }

  console.log('   Recent Mutations:');
  mutations.forEach((m: any, i: number) => {
    const status = m.is_done ? '✅ Complete' : `⏳ In Progress (${m.parts_to_do} parts left)`;
    const cmd = m.command.substring(0, 50) + '...';
    console.log(`     ${i + 1}. ${cmd}`);
    console.log(`        Status: ${status}`);
    console.log(`        Created: ${m.create_time}`);
    if (m.latest_fail_reason) {
      console.log(`        Error: ${m.latest_fail_reason}`);
    }
  });
  console.log('');

  const allDone = mutations.every((m: any) => m.is_done === 1);
  return allDone;
}

async function verifyFixes() {
  console.log('\n4️⃣  Verifying Fixes (sample check)...\n');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND (pnl_usd != 0 OR exit_value != 0 OR is_closed = 1)) as bad_unresolved,
        countIf(resolved_at IS NOT NULL AND
                ((tokens_held <= 0.01 AND is_closed = 0) OR
                 (tokens_held > 0.01 AND is_closed = 1))) as bad_closed_flag
      FROM ${TABLE_NAME}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const verify = (await verifyResult.json())[0];

  console.log('   Verification Results (last 7 days sample):');
  console.log(`     Bad unresolved positions: ${verify.bad_unresolved.toLocaleString()}`);
  console.log(`     Bad is_closed flags: ${verify.bad_closed_flag.toLocaleString()}`);
  console.log('');

  if (verify.bad_unresolved === 0 && verify.bad_closed_flag === 0) {
    console.log('   ✅ Sample is clean! (mutations likely complete)\n');
    return true;
  } else {
    console.log('   ⚠️  Sample still has issues (mutations may still be running)\n');
    return false;
  }
}

async function main() {
  console.log('🔧 FIX MAIN UNIFIED TABLE');
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

    // Check status
    const allDone = await checkMutationStatus();

    // Verify (sample)
    const verified = await verifyFixes();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`   - Unresolved mutation: ${unresolvedTime} min (submitted)`);
    console.log(`   - is_closed mutation: ${closedTime} min (submitted)`);

    console.log(`\n📋 Mutation Status: ${allDone ? '✅ Complete' : '⏳ In Progress'}`);

    if (!allDone) {
      console.log('\n⏳ Mutations are still running in background.');
      console.log(`   Monitor with: SELECT * FROM system.mutations WHERE table = '${TABLE_NAME}'`);
      console.log('   Expected completion: 35-40 minutes from start');
      console.log('   Run verification later: npx tsx scripts/verify-unified-main.ts');
    } else if (verified) {
      console.log('\n✅ All fixes verified - table is clean!');
    }

    console.log('\n🎯 Next Steps:');
    console.log('   1. Wait for mutations to complete (~35-40 min total)');
    console.log('   2. Verify fixes: npx tsx scripts/verify-unified-main.ts');
    console.log('   3. Update table: npx tsx scripts/update-unified-main.ts (keep current)');
    console.log('   4. Optional: Dedupe overnight with sequential approach');
    console.log('');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fix error:', error);
    process.exit(1);
  }
}

main();
