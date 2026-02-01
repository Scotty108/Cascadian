#!/usr/bin/env npx tsx
/**
 * URGENT: Backup Correct Values Before Mutation Completes
 *
 * Saves the correct exit_value, pnl_usd, roi for closed positions
 * in unresolved markets BEFORE the main table mutation zeros them out.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function backupCorrectValues() {
  console.log('\n💾 Creating Backup of Correct Values...\n');

  // Create backup table with correct values for closed-unresolved positions
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_unified_closed_unresolved_backup
      ENGINE = Memory
      AS
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        exit_value,
        pnl_usd,
        roi
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
        AND tokens_held <= 0.01  -- Closed positions
        AND exit_value != 0      -- Still has correct values
    `,
  });

  // Count what we backed up
  const countResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as backed_up,
        formatReadableQuantity(sum(pnl_usd)) as total_pnl
      FROM pm_unified_closed_unresolved_backup
    `,
    format: 'JSONEachRow',
  });
  const stats = (await countResult.json())[0];

  console.log(`   ✅ Backed up ${stats.backed_up} positions`);
  console.log(`   Total PnL: ${stats.total_pnl}`);
  console.log('');

  return stats;
}

async function main() {
  console.log('💾 BACKUP CORRECT VALUES (URGENT)');
  console.log('═'.repeat(70));
  console.log('Creating backup BEFORE main table mutation zeros them out');
  console.log('═'.repeat(70));

  try {
    const stats = await backupCorrectValues();

    console.log('═'.repeat(70));
    console.log('📊 BACKUP COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\n✅ Backed up correct values for ${stats.backed_up} positions`);
    console.log('   Table: pm_unified_closed_unresolved_backup');
    console.log('   Use this to restore after mutations complete\n');
    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
