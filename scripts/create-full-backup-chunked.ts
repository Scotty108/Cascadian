#!/usr/bin/env npx tsx
/**
 * Create Full Backup - Chunked Approach
 * Copies data in yearly chunks to avoid timeout
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function createFullBackup() {
  const startTime = Date.now();
  console.log('🔄 Creating Full Backup (Chunked)\n');

  const backupTable = 'pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130';

  // Step 1: Drop old backup if exists
  console.log('1️⃣ Preparing backup table...');
  try {
    await clickhouse.command({
      query: `DROP TABLE IF EXISTS ${backupTable}`
    });
  } catch (e) {}

  // Step 2: Create empty backup table
  await clickhouse.command({
    query: `
      CREATE TABLE ${backupTable} AS pm_trade_fifo_roi_v3_mat_unified
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('   ✅ Backup table created\n');

  // Step 3: Copy data in yearly chunks
  const years = [2022, 2023, 2024, 2025, 2026];

  console.log('2️⃣ Copying data in chunks...\n');

  for (const year of years) {
    console.log(`   Copying ${year} data...`);

    await clickhouse.command({
      query: `
        INSERT INTO ${backupTable}
        SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
        WHERE toYear(entry_time) = ${year}
      `,
      clickhouse_settings: {
        max_execution_time: 600,
        send_timeout: 3600,
        receive_timeout: 3600
      }
    });

    const checkResult = await clickhouse.query({
      query: `SELECT formatReadableQuantity(count()) as rows FROM ${backupTable}`,
      format: 'JSONEachRow'
    });
    const check = (await checkResult.json<any>())[0];
    console.log(`   ✅ ${year} complete (Total so far: ${check.rows})`);
  }

  console.log('\n3️⃣ Verifying backup...');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniq(wallet)) as wallets,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as resolved,
        formatReadableQuantity(countIf(resolved_at IS NULL)) as unresolved
      FROM ${backupTable}
    `,
    format: 'JSONEachRow'
  });
  const verify = (await verifyResult.json<any>())[0];

  const originalResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniq(wallet)) as wallets,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as resolved,
        formatReadableQuantity(countIf(resolved_at IS NULL)) as unresolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const original = (await originalResult.json<any>())[0];

  console.log('\n📊 BACKUP VERIFICATION:');
  console.log('\n   Original Table:');
  console.log(`     Total: ${original.total_rows}`);
  console.log(`     Wallets: ${original.wallets}`);
  console.log(`     Resolved: ${original.resolved}`);
  console.log(`     Unresolved: ${original.unresolved}`);

  console.log('\n   Backup Table:');
  console.log(`     Total: ${verify.total_rows}`);
  console.log(`     Wallets: ${verify.wallets}`);
  console.log(`     Resolved: ${verify.resolved}`);
  console.log(`     Unresolved: ${verify.unresolved}`);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ FULL BACKUP COMPLETE in ${elapsed} minutes`);
  console.log(`\nBackup table: ${backupTable}\n`);
}

createFullBackup().catch(console.error);
