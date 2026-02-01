#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function mergeSequential() {
  console.log('🔨 Phase 1: Sequential Merge to Production\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  const startTime = Date.now();

  // Step 1: Drop and create
  console.log('1️⃣ Dropping old production table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified` });
  console.log('   ✅ Dropped\n');

  console.log('2️⃣ Creating production table...');
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified (
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
      ) ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('   ✅ Created\n');

  // Step 2: Copy 2-day test (48.9M rows)
  console.log('3️⃣ Copying 2-day test data (48.9M rows)...');
  const s2Start = Date.now();
  await clickhouse.query({
    query: `INSERT INTO pm_trade_fifo_roi_v3_mat_unified SELECT * FROM pm_trade_fifo_roi_v3_mat_unified_2d_test`,
    request_timeout: 600000,
    clickhouse_settings: {
      max_execution_time: 600 as any,
      send_timeout: 600 as any,
      receive_timeout: 600 as any,
    }
  });
  console.log(`   ✅ Done (${((Date.now() - s2Start) / 1000 / 60).toFixed(1)} min)\n`);

  // Step 3: Insert new 10-day unresolved directly (wallets are already disjoint)
  console.log('4️⃣ Inserting new 10-day unresolved (8.3M rows)...');
  const s3Start = Date.now();
  await clickhouse.query({
    query: `INSERT INTO pm_trade_fifo_roi_v3_mat_unified SELECT * FROM pm_trade_fifo_roi_v3_mat_unresolved_new`,
    request_timeout: 600000,
    clickhouse_settings: {
      max_execution_time: 600 as any,
      send_timeout: 600 as any,
      receive_timeout: 600 as any,
    }
  });
  console.log(`   ✅ Done (${((Date.now() - s3Start) / 1000 / 60).toFixed(1)} min)\n`);

  // Step 4: Verification
  console.log('5️⃣ Verifying production table...\n');
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(resolved_at IS NULL) as unresolved_rows
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });

  const stats = (await verifyResult.json())[0];
  console.log('📊 Production Table Stats:');
  console.log(`   Total rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`   Unique keys: ${stats.unique_keys.toLocaleString()}`);
  console.log(`   Duplicates: ${stats.duplicates.toLocaleString()} ${stats.duplicates === '0' ? '✅' : '⚠️'}`);
  console.log(`   Unique wallets: ${stats.unique_wallets.toLocaleString()}`);
  console.log(`   Resolved rows: ${stats.resolved_rows.toLocaleString()}`);
  console.log(`   Unresolved rows: ${stats.unresolved_rows.toLocaleString()}\n`);

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('='.repeat(60));
  console.log(`✅ Production table ready! (${totalElapsed} min total)\n`);
  console.log('📋 Table: pm_trade_fifo_roi_v3_mat_unified');
  console.log(`📊 Rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`👥 Wallets: ${stats.unique_wallets.toLocaleString()}\n`);
  console.log('Note: This has 2-day + 10-day unresolved only.');
  console.log('For resolved positions, we need the full resolved table merge.\n');
  console.log('='.repeat(60) + '\n');
}

mergeSequential().catch(console.error);
