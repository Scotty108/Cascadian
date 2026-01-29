#!/usr/bin/env npx tsx
/**
 * Phase 1: 10-Day Unified Table - Final Merge
 *
 * Merges 3 sources into production table:
 * 1. 2-day test (160k wallets, full history)
 * 2. New unresolved positions (230k wallets)
 * 3. Resolved positions for ALL 390k wallets
 *
 * Uses GROUP BY deduplication to handle any overlaps
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function mergeToProduction() {
  console.log('🔨 Phase 1: Final Merge to Production\n');
  console.log('⏰ Started at:', new Date().toLocaleString());

  const startTime = Date.now();

  // Step 1: Drop old production table if exists
  console.log('1️⃣ Dropping old production table (if exists)...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified`
  });
  console.log('   ✅ Old table dropped\n');

  // Step 2: Create production table
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
  console.log('   ✅ Production table created\n');

  // Step 3: Insert from 3 sources with deduplication
  console.log('3️⃣ Merging data from 3 sources...');
  console.log('   - Source 1: 2-day test (160k wallets, full history)');
  console.log('   - Source 2: New unresolved positions (230k NEW wallets)');
  console.log('   - Source 3: Resolved positions for ALL 390k wallets\n');

  const mergeStart = Date.now();

  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        tx_hash, wallet, condition_id, outcome_index,
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
        any(is_closed) as is_closed
      FROM (
        -- Source 1: 2-day test (160k wallets, FULL history - both resolved + unresolved)
        SELECT * FROM pm_trade_fifo_roi_v3_mat_unified_2d_test

        UNION ALL

        -- Source 2: New unresolved positions (230k wallets NOT in 2-day test)
        SELECT * FROM pm_trade_fifo_roi_v3_mat_unresolved_new

        UNION ALL

        -- Source 3: Resolved positions for ALL 390k wallets
        SELECT
          tx_hash, wallet, condition_id, outcome_index, entry_time,
          resolved_at, cost_usd, tokens, tokens_sold_early, tokens_held,
          exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_short,
          1 as is_closed  -- All resolved positions are closed
        FROM pm_trade_fifo_roi_v3_mat_deduped
        WHERE wallet IN (
          SELECT DISTINCT wallet FROM (
            SELECT wallet FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
            UNION ALL
            SELECT wallet FROM pm_trade_fifo_roi_v3_mat_unresolved_new
          )
        )
      )
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    request_timeout: 3600000,  // 60 minutes
    clickhouse_settings: {
      max_execution_time: 3600 as any,  // 60 minutes
      max_memory_usage: 20000000000 as any,  // 20GB for large merge
    }
  });

  const mergeElapsed = ((Date.now() - mergeStart) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Merge complete (${mergeElapsed} min)\n`);

  // Step 4: Verification
  console.log('4️⃣ Verifying production table...\n');

  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at IS NOT NULL) as resolved_rows,
        countIf(resolved_at IS NULL) as unresolved_rows,
        countIf(is_short = 1) as short_positions,
        countIf(is_closed = 1) as closed_positions
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
  console.log(`   Unresolved rows: ${stats.unresolved_rows.toLocaleString()}`);
  console.log(`   SHORT positions: ${stats.short_positions.toLocaleString()}`);
  console.log(`   Closed positions: ${stats.closed_positions.toLocaleString()}\n`);

  if (stats.duplicates !== '0') {
    console.error('❌ VERIFICATION FAILED: Duplicates found!');
    process.exit(1);
  }

  if (parseInt(stats.unique_wallets) < 350000) {
    console.error(`⚠️  WARNING: Expected ~390k wallets, got ${stats.unique_wallets.toLocaleString()}`);
    console.error('   This might indicate missing data.\n');
  }

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('='.repeat(60));
  console.log(`✅ Production table ready! (${totalElapsed} min total)\n`);
  console.log('📋 Table: pm_trade_fifo_roi_v3_mat_unified');
  console.log(`📊 Rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`👥 Wallets: ${stats.unique_wallets.toLocaleString()}\n`);
  console.log('🎉 Ready to deploy leaderboard!');
  console.log('   npx tsx scripts/analysis/hyperdiversified-2day.ts\n');
  console.log('='.repeat(60) + '\n');
}

mergeToProduction().catch((error) => {
  console.error('❌ Merge error:', error);
  process.exit(1);
});
