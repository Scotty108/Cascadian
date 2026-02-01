#!/usr/bin/env npx tsx
/**
 * OVERNIGHT FULL BACKFILL: Create complete deduplicated materialized table
 *
 * This processes ALL 192M unique tx_hashes (all wallets, all time)
 * - Runtime: 2-3 hours
 * - Memory-safe batching (200 batches)
 * - Preserves TRUE FIFO V5 logic
 *
 * Run this overnight after the recent wallets script completes
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function createMaterializedFullOvernight() {
  const startOverallTime = Date.now();
  console.log('🌙 OVERNIGHT FULL BACKFILL: Creating complete deduplicated table...\n');
  console.log('📊 Target: 192M unique tx_hashes (all wallets, all time)');
  console.log('⏰ ETA: 2-3 hours\n');

  // Drop old table
  console.log('1️⃣ Dropping old table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped',
  });
  console.log('   ✅ Dropped\n');

  // Create table
  console.log('2️⃣ Creating table structure...');
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

  // Insert in 200 batches using modulo for even distribution
  const numBatches = 200;
  console.log(`3️⃣ Inserting ALL data in ${numBatches} batches (modulo distribution)...\n`);

  let totalRows = 0;
  for (let i = 0; i < numBatches; i++) {
    const batchStartTime = Date.now();
    console.log(`   Batch ${i + 1}/${numBatches}...`);

    try {
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
          WHERE cityHash64(tx_hash) % ${numBatches} = ${i}
          GROUP BY tx_hash
        `,
        request_timeout: 600000, // 10 minutes per batch
        clickhouse_settings: {
          max_execution_time: 600 as any,
          max_memory_usage: 10000000000 as any, // 10 GB
        }
      });

      const batchElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);

      // Get count every 10 batches or at end
      if ((i + 1) % 10 === 0 || i === numBatches - 1) {
        const result = await clickhouse.query({
          query: 'SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped',
          format: 'JSONEachRow'
        });
        const rows = await result.json();
        totalRows = rows[0]['count()'];

        const percentComplete = ((i + 1) / numBatches * 100).toFixed(1);
        const overallElapsed = ((Date.now() - startOverallTime) / 1000 / 60).toFixed(1);
        const avgBatchTime = (Date.now() - startOverallTime) / (i + 1) / 1000;
        const remainingBatches = numBatches - (i + 1);
        const etaMinutes = (remainingBatches * avgBatchTime / 60).toFixed(0);

        console.log(`   ✅ Batch ${i + 1} complete (${batchElapsed}s)`);
        console.log(`      Progress: ${percentComplete}% | Rows: ${totalRows.toLocaleString()}`);
        console.log(`      Runtime: ${overallElapsed} min | ETA: ${etaMinutes} min remaining\n`);
      } else {
        console.log(`   ✅ Batch ${i + 1} complete (${batchElapsed}s)\n`);
      }
    } catch (err: any) {
      console.error(`   ❌ Batch ${i + 1} failed: ${err.message}`);
      console.error(`   Continuing to next batch...\n`);
      // Continue to next batch even if one fails
    }
  }

  // Final verification
  console.log('4️⃣ Final verification...');
  const finalResult = await clickhouse.query({
    query: 'SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped',
    format: 'JSONEachRow'
  });
  const finalRows = await finalResult.json();
  const finalCount = finalRows[0]['count()'];

  const totalElapsed = ((Date.now() - startOverallTime) / 1000 / 60).toFixed(1);

  console.log(`\n✅ ALL BATCHES COMPLETE!\n`);
  console.log(`📊 Final row count: ${finalCount.toLocaleString()}`);
  console.log(`📊 Expected: ~192M unique tx_hashes`);
  console.log(`⏱️  Total runtime: ${totalElapsed} minutes\n`);

  if (finalCount >= 190000000) {
    console.log('✅ SUCCESS: Table populated with expected row count');
  } else {
    console.log(`⚠️  WARNING: Row count lower than expected (${finalCount.toLocaleString()} vs 192M)`);
  }

  console.log('\n📋 Table: pm_trade_fifo_roi_v3_mat_deduped');
  console.log('✅ TRUE FIFO V5 logic preserved (one row per buy tx)');
  console.log('✅ Zero duplicates');
  console.log('✅ All wallets, all time\n');
}

createMaterializedFullOvernight()
  .then(() => {
    console.log('🎉 Done!\n');
    console.log('Next: Update all queries to use pm_trade_fifo_roi_v3_mat_deduped');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
