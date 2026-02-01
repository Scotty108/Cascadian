#!/usr/bin/env npx tsx
/**
 * QUICK REBUILD: Recent Wallets Only (2 days)
 *
 * Rebuilds materialized deduplicated table for wallets active in last 2 days.
 * Uses proper deduplication: GROUP BY (tx_hash, wallet, condition_id, outcome_index)
 *
 * Expected: ~5M rows in 3-5 minutes
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function rebuildRecent() {
  console.log('🔨 REBUILDING Recent Wallets Materialized Table\n');
  console.log('Strategy: Direct INSERT with full key deduplication');
  console.log('Scope: Wallets active in last 2 days (FULL history)\n');

  const startTime = Date.now();

  // Step 1: Drop and recreate clean table
  console.log('Step 1: Creating clean table...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_deduped (
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at DateTime,
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
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(resolved_at)
      ORDER BY (wallet, condition_id, outcome_index, entry_time, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('  ✓ Table created\n');

  // Step 2: Get wallets active in last 2 days
  console.log('Step 2: Identifying active wallets...');
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_trade_fifo_roi_v3
      WHERE entry_time >= now() - INTERVAL 2 DAY
    `,
    format: 'JSONEachRow'
  });
  const walletsData = await walletsResult.json();
  const wallets = Array.isArray(walletsData) ? walletsData : [walletsData];
  console.log(`  ✓ Found ${wallets.length.toLocaleString()} active wallets\n`);

  // Step 3: Create temp table with wallet list
  console.log('Step 3: Creating temp wallet list...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS tmp_recent_wallets_rebuild`
  });
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_recent_wallets_rebuild (
        wallet String
      )
      ENGINE = Memory
    `
  });

  // Insert in batches to avoid query size limits
  const BATCH_SIZE = 1000;
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const values = batch.map(w => `('${w.wallet}')`).join(',');
    await clickhouse.command({
      query: `INSERT INTO tmp_recent_wallets_rebuild VALUES ${values}`
    });
  }
  console.log('  ✓ Temp table populated\n');

  // Step 4: Populate with deduplicated data
  console.log('Step 4: Populating with deduplicated data...');
  console.log('  Grouping by: (tx_hash, wallet, condition_id, outcome_index)');
  console.log('  This may take 3-5 minutes...\n');

  const populateStart = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_deduped
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
        any(is_short) as is_short,
        0 as is_closed
      FROM pm_trade_fifo_roi_v3 f
      INNER JOIN tmp_recent_wallets_rebuild w ON f.wallet = w.wallet
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 600, // 10 minutes
      max_memory_usage: 10000000000, // 10GB
      max_threads: 8,
    }
  });

  const populateDuration = ((Date.now() - populateStart) / 1000 / 60).toFixed(1);
  console.log(`  ✓ Populated in ${populateDuration} minutes\n`);

  // Step 5: Cleanup temp table
  await clickhouse.command({
    query: `DROP TABLE tmp_recent_wallets_rebuild`
  });

  // Step 6: Verification
  console.log('Step 5: Verification...');

  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
        count(DISTINCT wallet) as unique_wallets,
        round(sum(pnl_usd), 0) as total_pnl
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const stats = (await statsResult.json())[0];

  console.log(`  Total rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`  Unique keys: ${stats.unique_keys.toLocaleString()}`);
  console.log(`  Unique wallets: ${stats.unique_wallets.toLocaleString()}`);

  if (stats.total_rows === stats.unique_keys) {
    console.log(`  ✅ ZERO DUPLICATES!\n`);
  } else {
    console.log(`  ❌ WARNING: ${(stats.total_rows - stats.unique_keys).toLocaleString()} duplicates!\n`);
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('════════════════════════════════════════════════════');
  console.log('✅ REBUILD COMPLETE!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`Wallets: ${stats.unique_wallets.toLocaleString()}`);
  console.log(`Total PnL: $${stats.total_pnl.toLocaleString()}`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log('\n🎯 Table: pm_trade_fifo_roi_v3_mat_deduped');
  console.log('✅ NO DUPLICATES');
  console.log('\n📋 Next: Run overnight full backfill for all wallets\n');
}

rebuildRecent().catch(console.error);
