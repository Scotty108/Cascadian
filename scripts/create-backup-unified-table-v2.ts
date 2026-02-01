#!/usr/bin/env npx tsx
/**
 * Create Backup of pm_trade_fifo_roi_v3_mat_unified
 *
 * Creates: pm_trade_fifo_roi_v3_mat_unified_backup_20260129
 * Before: Incremental refresh implementation
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function createBackup() {
  console.log('🔒 Creating backup of pm_trade_fifo_roi_v3_mat_unified\n');
  console.log('Backup table: pm_trade_fifo_roi_v3_mat_unified_backup_20260129\n');

  const startTime = Date.now();

  // Drop backup if exists
  console.log('1️⃣ Dropping old backup if exists...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_backup_20260129'
  });
  console.log('   ✅ Done\n');

  // Create backup table structure
  console.log('2️⃣ Creating backup table structure...');
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_backup_20260129 (
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at Nullable(DateTime),
        tokens Float64,
        cost_usd Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        is_closed UInt8,
        is_short UInt8
      )
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('   ✅ Structure created\n');

  // Insert data
  console.log('3️⃣ Copying data (588M rows - this will take 2-3 minutes)...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_backup_20260129
      SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    clickhouse_settings: {
      max_execution_time: 3600,  // 1 hour for safety
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Data copied (${elapsed} minutes)\n`);

  // Verify backup
  console.log('4️⃣ Verifying backup...');
  const originalResult = await clickhouse.query({
    query: 'SELECT count() as count, uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unified',
    format: 'JSONEachRow'
  });
  const original = (await originalResult.json())[0];

  const backupResult = await clickhouse.query({
    query: 'SELECT count() as count, uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_unified_backup_20260129',
    format: 'JSONEachRow'
  });
  const backup = (await backupResult.json())[0];

  console.log('   Original table:');
  console.log(`     Rows: ${original.count.toLocaleString()}`);
  console.log(`     Wallets: ${original.wallets.toLocaleString()}`);
  console.log('   Backup table:');
  console.log(`     Rows: ${backup.count.toLocaleString()}`);
  console.log(`     Wallets: ${backup.wallets.toLocaleString()}`);

  if (original.count === backup.count && original.wallets === backup.wallets) {
    console.log('\n   ✅ Backup verified - counts match!\n');
  } else {
    console.log('\n   ❌ WARNING: Counts do not match!\n');
    throw new Error('Backup verification failed');
  }

  // Get size
  const sizeResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableSize(sum(data_compressed_bytes)) as compressed,
        formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed
      FROM system.parts
      WHERE table = 'pm_trade_fifo_roi_v3_mat_unified_backup_20260129'
        AND database = 'default'
        AND active = 1
    `,
    format: 'JSONEachRow'
  });
  const size = (await sizeResult.json())[0];

  console.log('📊 Backup size:');
  console.log(`   Compressed: ${size.compressed}`);
  console.log(`   Uncompressed: ${size.uncompressed}\n`);

  console.log('✅ Backup complete!\n');
  console.log('To restore from backup:');
  console.log('  1. DROP TABLE pm_trade_fifo_roi_v3_mat_unified');
  console.log('  2. RENAME TABLE pm_trade_fifo_roi_v3_mat_unified_backup_20260129 TO pm_trade_fifo_roi_v3_mat_unified\n');
}

createBackup().catch(console.error);
