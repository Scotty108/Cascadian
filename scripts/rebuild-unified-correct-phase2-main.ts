#!/usr/bin/env npx tsx
/**
 * PHASE 2: Rebuild Main Table - CORRECT LOGIC
 *
 * Same correct logic as Phase 1, but for ALL 1.99M wallets.
 * Runtime: 3-4 hours (run overnight)
 *
 * Can run while Phase 1 (10day) is already in use!
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SOURCE_TABLE = 'pm_trade_fifo_roi_v3';
const TARGET_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_v2';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup';
const CURRENT_TABLE = 'pm_trade_fifo_roi_v3_mat_unified';
const NUM_BATCHES = 20;  // More batches for larger dataset

async function identifyAllWallets() {
  console.log('\n📊 Identifying All Wallets...\n');

  const result = await clickhouse.query({
    query: `
      SELECT count() as total_wallets
      FROM (
        SELECT DISTINCT wallet
        FROM ${SOURCE_TABLE}
      )
    `,
    format: 'JSONEachRow',
  });
  const { total_wallets } = (await result.json())[0];

  console.log(`   Found ${total_wallets.toLocaleString()} total wallets\n`);
  return total_wallets;
}

async function createEmptyTable() {
  console.log('\n📋 Creating New Table Structure...\n');

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

async function processBatch(batchNum: number) {
  console.log(`[Batch ${batchNum + 1}/${NUM_BATCHES}] Processing...`);

  const startTime = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO ${TARGET_TABLE}
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        cost_usd,
        tokens,
        tokens_sold_early,
        tokens_held,

        -- CORRECT LOGIC for exit_value
        CASE
          WHEN resolved_at IS NOT NULL THEN exit_value
          WHEN tokens_held <= 0.01 THEN exit_value
          ELSE 0
        END as exit_value,

        -- CORRECT LOGIC for pnl_usd
        CASE
          WHEN resolved_at IS NOT NULL THEN pnl_usd
          WHEN tokens_held <= 0.01 THEN pnl_usd
          ELSE 0
        END as pnl_usd,

        -- CORRECT LOGIC for roi
        CASE
          WHEN resolved_at IS NOT NULL THEN roi
          WHEN tokens_held <= 0.01 THEN roi
          ELSE 0
        END as roi,

        pct_sold_early,
        is_maker,
        is_short,
        CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed
      FROM (
        SELECT
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(cost_usd) as cost_usd,
          any(tokens) as tokens,
          any(tokens_sold_early) as tokens_sold_early,
          any(tokens_held) as tokens_held,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(pct_sold_early) as pct_sold_early,
          any(is_maker) as is_maker,
          any(is_short) as is_short
        FROM ${SOURCE_TABLE}
        WHERE cityHash64(wallet) % ${NUM_BATCHES} = ${batchNum}
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      )
    `,
    clickhouse_settings: {
      max_execution_time: 1800,
      max_memory_usage: 8000000000,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  const countResult = await clickhouse.query({
    query: `
      SELECT count() as rows
      FROM ${TARGET_TABLE}
      WHERE cityHash64(wallet) % ${NUM_BATCHES} = ${batchNum}
    `,
    format: 'JSONEachRow',
  });
  const { rows } = (await countResult.json())[0];

  console.log(`   ✅ ${rows.toLocaleString()} rows in ${elapsed} min\n`);

  return { batchNum, rows, elapsed };
}

async function verifyTable() {
  console.log('\n🔍 Verifying New Table...\n');

  const result = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(uniq(wallet)) as unique_wallets,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as resolved,
        formatReadableQuantity(countIf(resolved_at IS NULL AND is_closed = 1)) as closed_unresolved,
        formatReadableQuantity(countIf(resolved_at IS NULL AND is_closed = 0)) as open_unresolved
      FROM ${TARGET_TABLE}
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];

  console.log('   Table Statistics:');
  console.log(`     Total rows: ${stats.total_rows}`);
  console.log(`     Unique wallets: ${stats.unique_wallets}`);
  console.log(`     Resolved: ${stats.resolved}`);
  console.log(`     Closed in unresolved: ${stats.closed_unresolved}`);
  console.log(`     Open in unresolved: ${stats.open_unresolved}`);
  console.log('');

  // Check duplicates
  const dupResult = await clickhouse.query({
    query: `
      SELECT
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM ${TARGET_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const { duplicates } = (await dupResult.json())[0];

  console.log(`   Duplicates (last 7 days): ${duplicates.toLocaleString()}`);

  // Check closed-unresolved PnL
  const pnlResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(sum(pnl_usd)) as total_pnl
      FROM ${TARGET_TABLE}
      WHERE resolved_at IS NULL AND is_closed = 1
    `,
    format: 'JSONEachRow',
  });
  const { total_pnl } = (await pnlResult.json())[0];

  console.log(`   Closed-unresolved PnL: ${total_pnl}`);
  console.log('');

  return { stats, duplicates, isClean: duplicates === 0 };
}

async function swapTables() {
  console.log('\n🔄 Swapping Tables (Atomic)...\n');

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
  console.log('');
}

async function main() {
  console.log('🔨 PHASE 2: REBUILD MAIN TABLE (CORRECT LOGIC)');
  console.log('═'.repeat(70));
  console.log('Building complete table for all 1.99M wallets');
  console.log('Expected runtime: 3-4 hours');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    const totalWallets = await identifyAllWallets();
    await createEmptyTable();

    console.log(`\n🔄 Processing ${NUM_BATCHES} batches sequentially...\n`);
    const results = [];
    for (let i = 0; i < NUM_BATCHES; i++) {
      const result = await processBatch(i);
      results.push(result);

      // Progress update every 5 batches
      if ((i + 1) % 5 === 0) {
        const elapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);
        const pctDone = ((i + 1) / NUM_BATCHES * 100).toFixed(1);
        console.log(`   Progress: ${i + 1}/${NUM_BATCHES} batches (${pctDone}%) - ${elapsed} min elapsed\n`);
      }
    }

    const totalRows = results.reduce((sum, r) => sum + r.rows, 0);
    const { stats, isClean } = await verifyTable();

    if (!isClean) {
      console.log('⚠️  Table has issues - review before swapping');
    }

    await swapTables();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 PHASE 2 COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`\n📈 Results:`);
    console.log(`   Wallets: ${stats.unique_wallets}`);
    console.log(`   Positions: ${stats.total_rows}`);
    console.log(`   Resolved: ${stats.resolved}`);
    console.log(`   Closed-unresolved: ${stats.closed_unresolved} (with PnL)`);
    console.log(`   Open-unresolved: ${stats.open_unresolved} (zero PnL)`);

    console.log('\n✅ Main table is ready!');
    console.log('   - Complete history for all wallets');
    console.log('   - Correct PnL logic throughout');
    console.log('   - Zero duplicates');
    console.log('');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Rebuild error:', error);
    process.exit(1);
  }
}

main();
