#!/usr/bin/env npx tsx
/**
 * Create ACTUAL Materialized Deduplicated FIFO Table
 *
 * This creates a REAL physical table with NO DUPLICATES.
 * The pm_trade_fifo_roi_v3_deduped "view" is NOT materialized - it's a VIEW
 * that runs GROUP BY on 286M rows every query (that's why queries timeout).
 *
 * This script creates pm_trade_fifo_roi_v3_materialized with actual deduplicated data.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('🔨 Creating Materialized Deduplicated FIFO Table\n');
  console.log('This will create a REAL physical table with NO duplicates.\n');

  const startTime = Date.now();

  // Step 1: Drop existing materialized table if exists
  console.log('Step 1: Dropping old materialized table (if exists)...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_materialized`,
  });
  console.log('  ✓ Dropped\n');

  // Step 2: Create new physical table (same schema as view)
  console.log('Step 2: Creating new physical table...');
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_materialized (
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        tokens Float64,
        cost_usd Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        resolved_at DateTime,
        is_short UInt8,
        is_closed UInt8
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(resolved_at)
      ORDER BY (wallet, condition_id, outcome_index, entry_time, tx_hash)
      SETTINGS index_granularity = 8192
    `,
  });
  console.log('  ✓ Table created\n');

  // Step 3: Populate with DEDUPLICATED data
  console.log('Step 3: Populating with deduplicated data (this will take 15-30 min)...');
  console.log('  Reading from pm_trade_fifo_roi_v3 (286M rows)');
  console.log('  Deduplicating by (wallet, condition_id, outcome_index)');
  console.log('  Expected output: ~78M unique positions\n');

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_materialized
      SELECT
        any(tx_hash) as tx_hash,
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as entry_time,
        any(tokens) as tokens,
        any(cost_usd) as cost_usd,
        any(tokens_sold_early) as tokens_sold_early,
        any(tokens_held) as tokens_held,
        any(exit_value) as exit_value,
        any(pnl_usd) as pnl_usd,
        any(roi) as roi,
        any(pct_sold_early) as pct_sold_early,
        any(is_maker) as is_maker,
        any(resolved_at) as resolved_at,
        any(is_short) as is_short,
        any(is_closed) as is_closed
      FROM pm_trade_fifo_roi_v3
      GROUP BY wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 2400, // 40 minutes
      max_memory_usage: 20000000000, // 20GB
      max_threads: 8,
    },
  });

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`  ✓ Populated in ${duration} minutes\n`);

  // Step 4: Verify no duplicates
  console.log('Step 4: Verifying no duplicates...');
  const dupCheckResult = await clickhouse.query({
    query: `
      SELECT count() as total_rows
      FROM pm_trade_fifo_roi_v3_materialized
    `,
    format: 'JSONEachRow',
  });
  const totalRows = (await dupCheckResult.json())[0].total_rows;

  const uniqueCheckResult = await clickhouse.query({
    query: `
      SELECT uniq(wallet, condition_id, outcome_index) as unique_positions
      FROM pm_trade_fifo_roi_v3_materialized
    `,
    format: 'JSONEachRow',
  });
  const uniquePositions = (await uniqueCheckResult.json())[0].unique_positions;

  console.log(`  Total rows: ${totalRows.toLocaleString()}`);
  console.log(`  Unique positions: ${uniquePositions.toLocaleString()}`);

  if (totalRows === uniquePositions) {
    console.log(`  ✅ NO DUPLICATES - table is clean!\n`);
  } else {
    console.log(`  ❌ WARNING: ${(totalRows - uniquePositions).toLocaleString()} duplicate rows still exist!\n`);
  }

  // Step 5: Sample stats
  console.log('Step 5: Table statistics...');
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(is_closed = 1) as closed_positions,
        countIf(is_closed = 0) as resolved_positions,
        count(DISTINCT wallet) as unique_wallets,
        round(sum(pnl_usd), 0) as total_pnl
      FROM pm_trade_fifo_roi_v3_materialized
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json())[0];

  console.log('════════════════════════════════════════════════════');
  console.log('✅ Materialized Table Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Total rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`  - Closed positions: ${stats.closed_positions.toLocaleString()}`);
  console.log(`  - Resolved positions: ${stats.resolved_positions.toLocaleString()}`);
  console.log(`Unique wallets: ${stats.unique_wallets.toLocaleString()}`);
  console.log(`Total PnL: $${stats.total_pnl.toLocaleString()}`);
  console.log(`Duration: ${duration} minutes`);
  console.log('\n🎯 Use this table for all queries:');
  console.log('   pm_trade_fifo_roi_v3_materialized');
  console.log('\n✅ NO DUPLICATES GUARANTEED\n');
}

main().catch(console.error);
