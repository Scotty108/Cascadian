#!/usr/bin/env npx tsx
/**
 * Create 10-Day Table from Full Unified Table
 *
 * Since the full table already exists (1.9M wallets), just copy the subset
 * of wallets that were active in the last 10 days.
 *
 * This is MUCH faster and simpler than rebuilding from scratch.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const FULL_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const TARGET_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_new';
const CURRENT_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_old';
const LOOKBACK_DAYS = 10;

async function createTable() {
  console.log('\n📋 Creating new 10-day table structure...\n');

  try {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TARGET_TABLE}` });
  } catch (e) {}

  await clickhouse.command({
    query: `
      CREATE TABLE ${TARGET_TABLE} (
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at Nullable(DateTime),
        cost_usd Float64,
        tokens Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        is_short UInt8,
        is_closed UInt8
      )
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `,
  });

  console.log('   ✅ Table created\n');
}

async function copyData() {
  console.log('📦 Copying data from full table...\n');
  console.log('   Strategy: All positions for wallets active in last 10 days\n');

  const startTime = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO ${TARGET_TABLE}
      SELECT *
      FROM ${FULL_TABLE}
      WHERE wallet IN (
        SELECT DISTINCT wallet
        FROM ${FULL_TABLE}
        WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
      )
    `,
    clickhouse_settings: {
      max_execution_time: 1800,
      max_memory_usage: 10000000000,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Data copied in ${elapsed} min\n`);
}

async function verifyTable() {
  console.log('🔍 Verifying new table...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        uniq(wallet) as unique_wallets,
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as resolved,
        formatReadableQuantity(countIf(resolved_at IS NULL AND is_closed = 1)) as closed_unresolved,
        formatReadableQuantity(countIf(resolved_at IS NULL AND is_closed = 0)) as open_unresolved
      FROM ${TARGET_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Table Statistics:');
  console.log(`     Unique wallets: ${stats.unique_wallets.toLocaleString()}`);
  console.log(`     Total rows: ${stats.total_rows}`);
  console.log(`     Resolved: ${stats.resolved}`);
  console.log(`     Closed in unresolved: ${stats.closed_unresolved}`);
  console.log(`     Open in unresolved: ${stats.open_unresolved}`);
  console.log('');

  return stats;
}

async function swapTables() {
  console.log('🔄 Swapping tables (atomic)...\n');

  try {
    await clickhouse.command({
      query: `
        RENAME TABLE
          ${CURRENT_TABLE} TO ${BACKUP_TABLE},
          ${TARGET_TABLE} TO ${CURRENT_TABLE}
      `,
    });
    console.log('   ✅ Tables swapped!\n');
    console.log(`     Old table backed up: ${BACKUP_TABLE}`);
    console.log(`     New table active: ${CURRENT_TABLE}`);
  } catch (error) {
    console.log('   ⚠️  Rename failed (table might not exist), creating fresh\n');
    await clickhouse.command({
      query: `RENAME TABLE ${TARGET_TABLE} TO ${CURRENT_TABLE}`,
    });
    console.log(`   ✅ New table active: ${CURRENT_TABLE}`);
  }
  console.log('');
}

async function main() {
  console.log('🔨 CREATE 10-DAY TABLE FROM FULL TABLE');
  console.log('═'.repeat(70));
  console.log('Strategy: Copy subset from existing full table (1.9M wallets)');
  console.log('Much faster than rebuilding from source!');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    await createTable();
    await copyData();
    const stats = await verifyTable();
    await swapTables();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`\n📈 Results:`);
    console.log(`   Wallets: ${stats.unique_wallets.toLocaleString()}`);
    console.log(`   Positions: ${stats.total_rows}`);
    console.log(`   Resolved: ${stats.resolved}`);
    console.log(`   Closed-unresolved: ${stats.closed_unresolved}`);
    console.log(`   Open-unresolved: ${stats.open_unresolved}`);

    console.log('\n✅ 10day table is ready!');
    console.log('   - Filtered from full table (already correct logic)');
    console.log('   - Complete history for 10-day active wallets');
    console.log('');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
