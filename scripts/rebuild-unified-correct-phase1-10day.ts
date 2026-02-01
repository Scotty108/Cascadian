#!/usr/bin/env npx tsx
/**
 * PHASE 1: Rebuild 10day Table - CORRECT LOGIC
 *
 * Rebuilds from clean source with ALL lessons learned:
 * 1. ✅ Closed positions in unresolved markets KEEP PnL (trading profits)
 * 2. ✅ Only OPEN positions in unresolved markets get zero PnL (unrealized)
 * 3. ✅ Proper deduplication (GROUP BY from start)
 * 4. ✅ Correct is_closed calculation
 * 5. ✅ Fresh data from source
 *
 * Result: Clean, optimized 10day table ready for immediate use
 * Runtime: 1-2 hours (sequential batching to avoid memory limits)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SOURCE_TABLE = 'pm_trade_fifo_roi_v3';
const TARGET_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_v2';
const BACKUP_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day_old';
const CURRENT_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_10day';
const NUM_BATCHES = 10;

async function identifyActiveWallets() {
  console.log('\n📊 Identifying Active Wallets (last 10 days)...\n');

  const result = await clickhouse.query({
    query: `
      SELECT count() as active_wallets
      FROM (
        SELECT DISTINCT wallet
        FROM ${SOURCE_TABLE}
        WHERE entry_time >= now() - INTERVAL 10 DAY
      )
    `,
    format: 'JSONEachRow',
  });
  const { active_wallets } = (await result.json())[0];

  console.log(`   Found ${active_wallets.toLocaleString()} wallets active in last 10 days\n`);
  return active_wallets;
}

async function createEmptyTable() {
  console.log('\n📋 Creating New Table Structure...\n');

  // Drop if exists
  try {
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TARGET_TABLE}` });
  } catch (e) {}

  // Create with proper structure
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
  console.log(`\n[Batch ${batchNum + 1}/${NUM_BATCHES}] Processing...\n`);

  const startTime = Date.now();

  // Insert with CORRECT LOGIC and deduplication
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
          WHEN tokens_held <= 0.01 THEN exit_value  -- Closed in unresolved: KEEP exit_value
          ELSE 0  -- Open in unresolved: zero
        END as exit_value,

        -- CORRECT LOGIC for pnl_usd
        CASE
          WHEN resolved_at IS NOT NULL THEN pnl_usd
          WHEN tokens_held <= 0.01 THEN pnl_usd  -- Closed in unresolved: KEEP PnL
          ELSE 0  -- Open in unresolved: zero (unrealized)
        END as pnl_usd,

        -- CORRECT LOGIC for roi
        CASE
          WHEN resolved_at IS NOT NULL THEN roi
          WHEN tokens_held <= 0.01 THEN roi  -- Closed in unresolved: KEEP ROI
          ELSE 0  -- Open in unresolved: zero
        END as roi,

        pct_sold_early,
        is_maker,
        is_short,

        -- CORRECT is_closed calculation
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
        WHERE wallet IN (
          -- Active wallets in last 10 days, partitioned by batch
          SELECT wallet
          FROM (
            SELECT DISTINCT wallet
            FROM ${SOURCE_TABLE}
            WHERE entry_time >= now() - INTERVAL 10 DAY
          )
          WHERE cityHash64(wallet) % ${NUM_BATCHES} = ${batchNum}
        )
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      )
    `,
    clickhouse_settings: {
      max_execution_time: 1800,
      max_memory_usage: 8000000000,  // 8 GB per batch
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Get row count for this batch
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as rows
      FROM ${TARGET_TABLE}
      WHERE cityHash64(wallet) % ${NUM_BATCHES} = ${batchNum}
    `,
    format: 'JSONEachRow',
  });
  const { rows } = (await countResult.json())[0];

  console.log(`   ✅ Batch ${batchNum + 1} complete: ${rows.toLocaleString()} rows in ${elapsed} min\n`);

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

  // Check for duplicates
  const dupResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM ${TARGET_TABLE}
      WHERE entry_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const dup = (await dupResult.json())[0];

  console.log('   Duplicate Check (last 7 days):');
  console.log(`     Total rows: ${dup.total.toLocaleString()}`);
  console.log(`     Unique keys: ${dup.unique.toLocaleString()}`);
  console.log(`     Duplicates: ${dup.duplicates.toLocaleString()}`);
  console.log('');

  // Check closed-unresolved PnL
  const pnlResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as positions,
        formatReadableQuantity(sum(pnl_usd)) as total_pnl,
        round(avg(pnl_usd), 2) as avg_pnl
      FROM ${TARGET_TABLE}
      WHERE resolved_at IS NULL
        AND is_closed = 1
    `,
    format: 'JSONEachRow',
  });
  const pnl = (await pnlResult.json())[0];

  console.log('   Closed-Unresolved PnL (SHOULD HAVE VALUES):');
  console.log(`     Positions: ${pnl.positions}`);
  console.log(`     Total PnL: ${pnl.total_pnl}`);
  console.log(`     Avg PnL: $${pnl.avg_pnl}`);
  console.log('');

  const isClean = dup.duplicates === 0 && parseFloat(pnl.total_pnl.replace(/[^0-9.]/g, '')) > 0;
  return { stats, isClean };
}

async function swapTables() {
  console.log('\n🔄 Swapping Tables (Atomic)...\n');

  // Backup old table
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
  console.log('🔨 PHASE 1: REBUILD 10DAY TABLE (CORRECT LOGIC)');
  console.log('═'.repeat(70));
  console.log('Applying ALL lessons learned:');
  console.log('  ✅ Closed-unresolved positions KEEP PnL (trading profits)');
  console.log('  ✅ Open-unresolved positions ZERO PnL (unrealized)');
  console.log('  ✅ Proper deduplication (GROUP BY)');
  console.log('  ✅ Correct is_closed calculation');
  console.log('  ✅ Fresh data from source');
  console.log('═'.repeat(70));
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  const totalStartTime = Date.now();

  try {
    // Step 1: Identify wallets
    const activeWallets = await identifyActiveWallets();

    // Step 2: Create empty table
    await createEmptyTable();

    // Step 3: Process in batches
    console.log(`\n🔄 Processing ${NUM_BATCHES} batches sequentially...\n`);
    const results = [];
    for (let i = 0; i < NUM_BATCHES; i++) {
      const result = await processBatch(i);
      results.push(result);
    }

    const totalRows = results.reduce((sum, r) => sum + r.rows, 0);
    const avgTime = results.reduce((sum, r) => sum + parseFloat(r.elapsed), 0) / NUM_BATCHES;

    console.log('\n📊 Batch Summary:');
    console.log('   ═'.repeat(35));
    results.forEach(r => {
      console.log(`   Batch ${r.batchNum + 1}: ${r.rows.toLocaleString()} rows (${r.elapsed} min)`);
    });
    console.log('   ═'.repeat(35));
    console.log(`   Total: ${totalRows.toLocaleString()} rows (avg ${avgTime.toFixed(1)} min/batch)\n`);

    // Step 4: Verify
    const { stats, isClean } = await verifyTable();

    if (!isClean) {
      console.log('⚠️  Table has issues - NOT swapping');
      console.log('   Review verification output above');
      process.exit(1);
    }

    // Step 5: Swap
    await swapTables();

    const totalElapsed = ((Date.now() - totalStartTime) / 1000 / 60).toFixed(1);

    console.log('═'.repeat(70));
    console.log('📊 PHASE 1 COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\n⏱️  Total Time: ${totalElapsed} minutes`);
    console.log(`\n📈 Results:`);
    console.log(`   Wallets: ${stats.unique_wallets}`);
    console.log(`   Positions: ${stats.total_rows}`);
    console.log(`   Resolved: ${stats.resolved}`);
    console.log(`   Closed-unresolved: ${stats.closed_unresolved} (with trading PnL)`);
    console.log(`   Open-unresolved: ${stats.open_unresolved} (zero PnL)`);

    console.log('\n✅ 10day table is ready for immediate use!');
    console.log('   - Correct PnL for all position types');
    console.log('   - Zero duplicates');
    console.log('   - Optimized for trade-by-trade queries');
    console.log('   - Use with GROUP BY pattern from HOW_TO_USE_10DAY_TABLE.md');

    console.log('\n🎯 Next Steps:');
    console.log('   1. Test queries on new 10day table');
    console.log('   2. Run Phase 2: npx tsx scripts/rebuild-unified-correct-phase2-main.ts');
    console.log('   3. (Optional) Drop backup: DROP TABLE ' + BACKUP_TABLE);
    console.log('');

    console.log('═'.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Rebuild error:', error);
    console.log(`\n   Target table preserved: ${TARGET_TABLE}`);
    console.log(`   Current table unchanged: ${CURRENT_TABLE}`);
    process.exit(1);
  }
}

main();
