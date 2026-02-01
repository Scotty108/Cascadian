#!/usr/bin/env npx tsx
/**
 * Create materialized deduplicated table for RECENT WALLETS ONLY
 * Uses temp table to avoid aggregation conflicts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function createMaterializedRecentFinal() {
  console.log('🔨 Creating materialized table for RECENT WALLETS (last 2 days activity)...\n');

  // Create temp table with active wallets
  console.log('1️⃣ Creating temp table with active wallets...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS temp_active_wallets (
        wallet LowCardinality(String)
      ) ENGINE = Memory
    `
  });

  await clickhouse.command({
    query: 'TRUNCATE TABLE temp_active_wallets'
  });

  await clickhouse.query({
    query: `
      INSERT INTO temp_active_wallets
      SELECT DISTINCT wallet
      FROM pm_trade_fifo_roi_v3
      WHERE entry_time >= now() - INTERVAL 2 DAY
    `
  });

  const walletCountResult = await clickhouse.query({
    query: 'SELECT count() FROM temp_active_wallets',
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${walletCount.toLocaleString()} active wallets\n`);

  // Drop old materialized table
  console.log('2️⃣ Dropping old materialized table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped',
  });
  console.log('   ✅ Dropped\n');

  // Create materialized table
  console.log('3️⃣ Creating table structure...');
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

  // Insert in batches using modulo
  console.log('4️⃣ Inserting FULL HISTORY for active wallets (100 batches)...\n');

  const numBatches = 100;
  for (let i = 0; i < numBatches; i++) {
    console.log(`   Batch ${i + 1}/${numBatches}...`);

    const startTime = Date.now();
    await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_deduped
        SELECT
          f.tx_hash,
          any(f.wallet) as wallet,
          any(f.condition_id) as condition_id,
          any(f.outcome_index) as outcome_index,
          any(f.entry_time) as entry_time,
          any(f.resolved_at) as resolved_at,
          any(f.cost_usd) as cost_usd,
          any(f.tokens) as tokens,
          any(f.tokens_sold_early) as tokens_sold_early,
          any(f.tokens_held) as tokens_held,
          any(f.exit_value) as exit_value,
          any(f.pnl_usd) as pnl_usd,
          any(f.roi) as roi,
          any(f.pct_sold_early) as pct_sold_early,
          any(f.is_maker) as is_maker,
          any(f.is_short) as is_short
        FROM pm_trade_fifo_roi_v3 f
        INNER JOIN temp_active_wallets w ON f.wallet = w.wallet
        WHERE cityHash64(f.tx_hash) % ${numBatches} = ${i}
        GROUP BY f.tx_hash
      `,
      request_timeout: 600000, // 10 minutes
      clickhouse_settings: {
        max_execution_time: 600 as any,
        max_memory_usage: 10000000000 as any, // 10 GB
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Get count every 10 batches
    if ((i + 1) % 10 === 0 || i === numBatches - 1) {
      const result = await clickhouse.query({
        query: 'SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped',
        format: 'JSONEachRow'
      });
      const rows = await result.json();
      const count = rows[0]['count()'];
      console.log(`   ✅ Batch ${i + 1} complete (${elapsed}s) - Total rows: ${count.toLocaleString()}\n`);
    } else {
      console.log(`   ✅ Batch ${i + 1} complete (${elapsed}s)\n`);
    }
  }

  // Cleanup
  await clickhouse.command({
    query: 'DROP TABLE temp_active_wallets'
  });

  // Get final count
  const result = await clickhouse.query({
    query: 'SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped',
    format: 'JSONEachRow'
  });
  const rows = await result.json();
  const finalCount = rows[0]['count()'];

  console.log(`\n✅ All batches complete!\n`);
  console.log(`📊 Final row count: ${finalCount.toLocaleString()}`);
  console.log(`📊 Active wallets covered: ${walletCount.toLocaleString()}`);
  console.log(`\n✅ Table ready for immediate use!`);
  console.log(`\n⏰ Run full backfill overnight to add remaining wallets`);
}

createMaterializedRecentFinal()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
