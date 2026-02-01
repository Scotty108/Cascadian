#!/usr/bin/env npx tsx
/**
 * Restore PnL for Closed Positions in Unresolved Markets
 *
 * Copies correct exit_value and pnl_usd from main table (not fixed yet)
 * for positions that are CLOSED (tokens_held <= 0.01) but market unresolved.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function restoreClosedUnresolvedPnL() {
  console.log('\n🔄 Restoring PnL for Closed Positions in Unresolved Markets...\n');

  // Step 1: Check how many need restoration
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as positions_to_restore
      FROM pm_trade_fifo_roi_v3_mat_unified_10day
      WHERE resolved_at IS NULL
        AND tokens_held <= 0.01  -- Closed
        AND exit_value = 0        -- Was zeroed out
    `,
    format: 'JSONEachRow',
  });
  const { positions_to_restore } = (await countResult.json())[0];

  console.log(`   Found ${positions_to_restore.toLocaleString()} closed positions to restore\n`);

  if (positions_to_restore === 0) {
    console.log('   ✅ No positions need restoration\n');
    return 0;
  }

  // Step 2: Restore by copying from main table
  console.log('   Restoring from main table...\n');

  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified_10day
      UPDATE
        exit_value = (
          SELECT exit_value
          FROM pm_trade_fifo_roi_v3_mat_unified m
          WHERE m.tx_hash = pm_trade_fifo_roi_v3_mat_unified_10day.tx_hash
            AND m.wallet = pm_trade_fifo_roi_v3_mat_unified_10day.wallet
            AND m.condition_id = pm_trade_fifo_roi_v3_mat_unified_10day.condition_id
            AND m.outcome_index = pm_trade_fifo_roi_v3_mat_unified_10day.outcome_index
          LIMIT 1
        ),
        pnl_usd = (
          SELECT pnl_usd
          FROM pm_trade_fifo_roi_v3_mat_unified m
          WHERE m.tx_hash = pm_trade_fifo_roi_v3_mat_unified_10day.tx_hash
            AND m.wallet = pm_trade_fifo_roi_v3_mat_unified_10day.wallet
            AND m.condition_id = pm_trade_fifo_roi_v3_mat_unified_10day.condition_id
            AND m.outcome_index = pm_trade_fifo_roi_v3_mat_unified_10day.outcome_index
          LIMIT 1
        ),
        roi = (
          SELECT roi
          FROM pm_trade_fifo_roi_v3_mat_unified m
          WHERE m.tx_hash = pm_trade_fifo_roi_v3_mat_unified_10day.tx_hash
            AND m.wallet = pm_trade_fifo_roi_v3_mat_unified_10day.wallet
            AND m.condition_id = pm_trade_fifo_roi_v3_mat_unified_10day.condition_id
            AND m.outcome_index = pm_trade_fifo_roi_v3_mat_unified_10day.outcome_index
          LIMIT 1
        ),
        is_closed = 1  -- Mark as closed
      WHERE resolved_at IS NULL
        AND tokens_held <= 0.01
        AND exit_value = 0
    `,
    clickhouse_settings: {
      max_execution_time: 1800,
    },
  });

  console.log(`   ✅ Restoration submitted (mutation running)\n`);

  return positions_to_restore;
}

async function verifyRestoration() {
  console.log('\n✅ Verifying Restoration...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        count() as closed_unresolved,
        formatReadableQuantity(sum(pnl_usd)) as total_pnl,
        round(avg(pnl_usd), 2) as avg_pnl
      FROM pm_trade_fifo_roi_v3_mat_unified_10day
      WHERE resolved_at IS NULL
        AND tokens_held <= 0.01
        AND entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Closed Positions in Unresolved Markets (sample):');
  console.log(`     Count: ${stats.closed_unresolved.toLocaleString()}`);
  console.log(`     Total PnL: ${stats.total_pnl}`);
  console.log(`     Avg PnL: $${stats.avg_pnl}`);
  console.log('');

  return stats;
}

async function main() {
  console.log('🔄 RESTORE PNL FOR CLOSED POSITIONS');
  console.log('═'.repeat(70));
  console.log('Fixing: Closed positions in unresolved markets should have PnL');
  console.log('Source: Main table (has correct values before fix)');
  console.log('═'.repeat(70));

  try {
    // Restore
    const restored = await restoreClosedUnresolvedPnL();

    // Verify
    if (restored > 0) {
      const stats = await verifyRestoration();

      console.log('═'.repeat(70));
      console.log('📊 SUMMARY');
      console.log('═'.repeat(70));
      console.log(`\n✅ Restored ${restored.toLocaleString()} closed positions`);
      console.log(`   These are trading profits from selling before market resolved`);
      console.log(`\n⏳ Mutation running in background (~5-10 min)`);
      console.log(`   Monitor: SELECT * FROM system.mutations WHERE table = 'pm_trade_fifo_roi_v3_mat_unified_10day'\n`);
    }

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
