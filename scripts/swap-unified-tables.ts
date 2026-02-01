#!/usr/bin/env npx tsx
/**
 * Swap Unified Tables
 *
 * Atomically swaps pm_trade_fifo_roi_v3_mat_unified_v2 (new) to become the production table.
 * Old table is preserved as pm_trade_fifo_roi_v3_mat_unified_backup.
 *
 * SAFETY: This is an atomic operation - zero downtime
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const OLD_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const NEW_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_v2';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup';

async function swapTables() {
  console.log('🔄 Swapping Unified Tables\n');
  console.log(`OLD (production): ${OLD_TABLE}`);
  console.log(`NEW (fresh):      ${NEW_TABLE}`);
  console.log(`BACKUP:           ${BACKUP_TABLE}\n`);

  // Safety check: Verify new table exists
  console.log('1️⃣ Safety checks...\n');

  const checkNewResult = await clickhouse.query({
    query: `
      SELECT
        count() as row_count,
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as unresolved_stale_min
      FROM ${NEW_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const newStats = (await checkNewResult.json<any>())[0];

  console.log(`   ${NEW_TABLE}:`);
  console.log(`      Rows: ${parseInt(newStats.row_count).toLocaleString()}`);
  console.log(`      Unresolved staleness: ${newStats.unresolved_stale_min} minutes\n`);

  if (parseInt(newStats.row_count) === 0) {
    console.error('❌ ERROR: New table is empty! Aborting.\n');
    process.exit(1);
  }

  if (newStats.unresolved_stale_min > 120) {
    console.warn(`⚠️  WARNING: New table unresolved data is ${newStats.unresolved_stale_min} minutes stale`);
    console.warn('   Continue anyway? (Ctrl+C to abort, Enter to continue)\n');
    await new Promise(resolve => process.stdin.once('data', resolve));
  }

  // Drop old backup if exists
  console.log(`2️⃣ Dropping old backup if exists...`);
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS ${BACKUP_TABLE}`,
  });
  console.log('   ✅ Clean slate\n');

  // Atomic swap
  console.log('3️⃣ Atomic table swap...');
  await clickhouse.command({
    query: `
      RENAME TABLE
        ${OLD_TABLE} TO ${BACKUP_TABLE},
        ${NEW_TABLE} TO ${OLD_TABLE}
    `,
  });
  console.log('   ✅ Tables swapped!\n');

  // Verify
  console.log('4️⃣ Verifying production table...\n');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as unresolved_stale_min,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as resolved_stale_min
      FROM ${OLD_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const prodStats = (await verifyResult.json<any>())[0];

  console.log(`📊 PRODUCTION TABLE (${OLD_TABLE}):`);
  console.log(`   Total rows: ${parseInt(prodStats.total_rows).toLocaleString()}`);
  console.log(`   Unique wallets: ${parseInt(prodStats.unique_wallets).toLocaleString()}`);
  console.log(`   Unresolved staleness: ${prodStats.unresolved_stale_min} minutes`);
  console.log(`   Resolved staleness: ${prodStats.resolved_stale_min} minutes\n`);

  console.log('✅ SWAP COMPLETE!\n');
  console.log('📋 STATUS:');
  console.log(`   ✅ ${OLD_TABLE} is now the fresh table (production)`);
  console.log(`   ✅ ${BACKUP_TABLE} contains the old data (backup)`);
  console.log(`   ✅ All queries now use fresh data\n`);

  console.log('🗑️  CLEANUP (optional):');
  console.log(`   Keep backup for 24-48 hours, then drop:`);
  console.log(`   DROP TABLE ${BACKUP_TABLE};\n`);
}

swapTables().catch(console.error);
