#!/usr/bin/env npx tsx
/**
 * Create materialized deduplicated table for RECENT WALLETS ONLY
 * Uses simple batching by wallet to avoid aggregation errors
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function createMaterializedRecentSimple() {
  console.log('🔨 Creating materialized table for RECENT WALLETS (last 2 days activity)...\n');

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

  // Get wallets active in last 2 days
  console.log('3️⃣ Finding wallets active in last 2 days...');
  const walletResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_trade_fifo_roi_v3
      WHERE entry_time >= now() - INTERVAL 2 DAY
    `,
    format: 'JSONEachRow'
  });
  const walletRows = await walletResult.json();
  const activeWallets: string[] = walletRows.map((row: any) => row.wallet);
  console.log(`   ✅ Found ${activeWallets.length.toLocaleString()} active wallets\n`);

  // Insert using modulo batching on the entire source table
  // Filter to recent wallets AFTER the GROUP BY
  console.log('4️⃣ Inserting FULL HISTORY for active wallets...');
  console.log(`   Using 100 modulo batches\n`);

  const numBatches = 100;
  for (let i = 0; i < numBatches; i++) {
    console.log(`   Batch ${i + 1}/${numBatches}...`);

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
        WHERE cityHash64(tx_hash) % ${numBatches} = ${i}
        GROUP BY tx_hash
        HAVING wallet IN (${activeWallets.slice(0, 50000).map(w => `'${w}'`).join(',')})
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

  // Get final count
  const result = await clickhouse.query({
    query: 'SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped',
    format: 'JSONEachRow'
  });
  const rows = await result.json();
  const finalCount = rows[0]['count()'];

  console.log(`\n✅ All batches complete!\n`);
  console.log(`📊 Final row count: ${finalCount.toLocaleString()}`);
  console.log(`📊 Wallets covered: ${activeWallets.length.toLocaleString()}`);
}

createMaterializedRecentSimple()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
