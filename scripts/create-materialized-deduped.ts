#!/usr/bin/env npx tsx
/**
 * Create materialized deduplicated table for TRUE FIFO V5 data
 *
 * CRITICAL: V5 creates MULTIPLE rows per position (one per buy tx).
 * We must deduplicate by tx_hash, NOT by position, to preserve per-trade logic!
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function createMaterializedDeduped() {
  console.log('🔨 Creating CORRECT materialized deduplicated table...\n');
  console.log('⚠️  Deduplicating by TX_HASH to preserve V5 per-trade logic!\n');

  // Drop if exists
  console.log('1️⃣ Dropping old table if exists...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped',
  });
  console.log('   ✅ Dropped\n');

  // Create table
  console.log('2️⃣ Creating new table structure...');
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_deduped (
        tx_hash String,
        wallet LowCardinality(String),
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
        is_short UInt8
      ) ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('   ✅ Table created\n');

  // Insert deduplicated data
  console.log('3️⃣ Inserting deduplicated data...');
  console.log('   📊 Deduplicating by tx_hash (keeps all buy transactions)');
  console.log('   ⏳ This will take 15-30 minutes...\n');

  const startTime = Date.now();

  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_deduped
      SELECT
        tx_hash,
        any(wallet) as wallet,
        any(condition_id) as condition_id,
        any(outcome_index) as outcome_index,
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
      FROM pm_trade_fifo_roi_v3
      GROUP BY tx_hash
    `,
    request_timeout: 3600000, // 1 hour client timeout
    clickhouse_settings: {
      max_execution_time: 3600 as any, // 1 hour server timeout
      max_memory_usage: 100000000000 as any, // 100GB
    }
  });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Insert complete in ${elapsed} minutes\n`);

  // Verify
  console.log('4️⃣ Verifying deduplication...');
  const result = await clickhouse.query({
    query: 'SELECT count() as rows FROM pm_trade_fifo_roi_v3_mat_deduped',
    format: 'JSONEachRow'
  });
  const data: any = await result.json();
  console.log(`   ✅ Final row count: ${data[0].rows.toLocaleString()}\n`);

  // Double-check: count distinct positions
  const posResult = await clickhouse.query({
    query: 'SELECT uniq(wallet, condition_id, outcome_index) as positions FROM pm_trade_fifo_roi_v3_mat_deduped',
    format: 'JSONEachRow'
  });
  const posData: any = await posResult.json();
  console.log(`   📊 Unique positions: ${posData[0].positions.toLocaleString()}`);
  console.log(`   📈 Avg buy txs per position: ${(data[0].rows / posData[0].positions).toFixed(2)}\n`);

  console.log('🎉 DONE! Table pm_trade_fifo_roi_v3_mat_deduped is ready');
  console.log('   ✅ Deduplicated by tx_hash - preserves V5 per-trade logic');
  console.log('   ✅ Multiple buy transactions per position = preserved');
}

createMaterializedDeduped().catch(console.error);
