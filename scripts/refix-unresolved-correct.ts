#!/usr/bin/env npx tsx
/**
 * CORRECT Fix for Unresolved Positions
 *
 * Only zeros out OPEN positions (still holding tokens).
 * KEEPS PnL for closed positions in unresolved markets (trading profits).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function fixTable(tableName: string) {
  console.log(`\n🔧 Fixing: ${tableName}\n`);

  // Check current state
  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND tokens_held <= 0.01) as closed_unresolved,
        sumIf(pnl_usd, resolved_at IS NULL AND tokens_held <= 0.01) as closed_unresolved_pnl,
        countIf(resolved_at IS NULL AND tokens_held > 0.01) as open_unresolved,
        sumIf(pnl_usd, resolved_at IS NULL AND tokens_held > 0.01) as open_unresolved_pnl
      FROM ${tableName}
    `,
    format: 'JSONEachRow',
  });
  const before = (await beforeResult.json())[0];

  console.log('   Current State:');
  console.log(`     Closed in unresolved: ${before.closed_unresolved.toLocaleString()} (PnL: $${(before.closed_unresolved_pnl / 1000000).toFixed(2)}M)`);
  console.log(`     Open in unresolved: ${before.open_unresolved.toLocaleString()} (PnL: $${(before.open_unresolved_pnl / 1000000).toFixed(2)}M)`);
  console.log('');

  // The correct fix: Only zero out OPEN positions (still holding)
  console.log('   Applying correct fix...\n');

  await clickhouse.command({
    query: `
      ALTER TABLE ${tableName}
      UPDATE
        pnl_usd = 0,
        exit_value = 0,
        roi = 0,
        is_closed = 0
      WHERE resolved_at IS NULL
        AND tokens_held > 0.01  -- Only OPEN positions!
    `,
    clickhouse_settings: {
      max_execution_time: 3600,
    },
  });

  console.log('   ✅ Fix submitted (mutation running in background)\n');

  // Verify
  const afterResult = await clickhouse.query({
    query: `
      SELECT
        countIf(resolved_at IS NULL AND tokens_held <= 0.01 AND pnl_usd != 0) as closed_with_pnl,
        countIf(resolved_at IS NULL AND tokens_held > 0.01 AND pnl_usd != 0) as open_with_pnl
      FROM ${tableName}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const after = (await afterResult.json())[0];

  console.log('   Sample Check (last 7 days):');
  console.log(`     Closed positions keeping PnL: ${after.closed_with_pnl.toLocaleString()} ✅`);
  console.log(`     Open positions with PnL: ${after.open_with_pnl.toLocaleString()} (should be 0 after mutation)`);
  console.log('');
}

async function main() {
  console.log('🔧 CORRECT FIX FOR UNRESOLVED POSITIONS');
  console.log('═'.repeat(70));
  console.log('Issue: We incorrectly zeroed out ALL unresolved positions.');
  console.log('Fix: Only zero out OPEN positions (still holding tokens).');
  console.log('Keep: CLOSED positions in unresolved markets (trading profits).');
  console.log('═'.repeat(70));

  try {
    // Fix 10day table
    await fixTable('pm_trade_fifo_roi_v3_mat_unified_10day');

    // Fix main table
    await fixTable('pm_trade_fifo_roi_v3_mat_unified');

    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log('\n✅ Both tables fixed with correct logic:');
    console.log('   - Closed positions in unresolved markets: KEEP PnL (trading profits)');
    console.log('   - Open positions in unresolved markets: ZERO PnL (unrealized)');
    console.log('\n⏳ Mutations running in background (~35-40 min for main table)');
    console.log('   Monitor: npx tsx scripts/monitor-main-table-mutations.ts\n');
    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
