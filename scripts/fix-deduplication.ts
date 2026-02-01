#!/usr/bin/env npx tsx
/**
 * QUICK FIX: Deduplicate by (tx_hash, wallet) to handle multi-wallet tx_hashes
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function fixDeduplication() {
  console.log('🔧 QUICK FIX: Recreating table with proper deduplication\n');

  // Drop and recreate
  console.log('1️⃣ Dropping old table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped',
  });
  console.log('   ✅ Dropped\n');

  console.log('2️⃣ Creating table...');
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
  console.log('   ✅ Created\n');

  // Create temp table with active wallets
  console.log('3️⃣ Finding active wallets...');
  await clickhouse.command({
    query: `CREATE TABLE IF NOT EXISTS temp_active_wallets (wallet LowCardinality(String)) ENGINE = Memory`
  });
  await clickhouse.command({ query: 'TRUNCATE TABLE temp_active_wallets' });
  await clickhouse.query({
    query: `INSERT INTO temp_active_wallets SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3 WHERE entry_time >= now() - INTERVAL 2 DAY`
  });

  const walletCountResult = await clickhouse.query({
    query: 'SELECT count() FROM temp_active_wallets',
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${walletCount.toLocaleString()} active wallets\n`);

  // Insert with CORRECT deduplication: GROUP BY (tx_hash, wallet)
  console.log('4️⃣ Inserting with (tx_hash, wallet) deduplication (100 batches)...\n');

  const numBatches = 100;
  for (let i = 0; i < numBatches; i++) {
    console.log(`   Batch ${i + 1}/${numBatches}...`);

    const startTime = Date.now();
    await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_deduped
        SELECT
          f.tx_hash,
          f.wallet,
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
        GROUP BY f.tx_hash, f.wallet
      `,
      request_timeout: 600000,
      clickhouse_settings: {
        max_execution_time: 600 as any,
        max_memory_usage: 10000000000 as any,
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

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
  await clickhouse.command({ query: 'DROP TABLE temp_active_wallets' });

  // Final verification
  console.log('5️⃣ Verifying...');
  const verifyResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(tx_hash) as unique_txhashes,
        uniq(tx_hash, wallet) as unique_tx_wallet_pairs,
        count() - uniq(tx_hash, wallet) as duplicates
      FROM pm_trade_fifo_roi_v3_mat_deduped
    `,
    format: 'JSONEachRow'
  });
  const verifyData = await verifyResult.json();

  console.log(`\n📊 Final row count: ${verifyData[0].total_rows.toLocaleString()}`);
  console.log(`📊 Unique (tx_hash, wallet) pairs: ${verifyData[0].unique_tx_wallet_pairs.toLocaleString()}`);
  console.log(`📊 Duplicates: ${verifyData[0].duplicates.toLocaleString()}`);

  if (verifyData[0].duplicates === 0) {
    console.log('\n✅ SUCCESS: Zero duplicates!');
  } else {
    console.log('\n❌ Still have duplicates!');
  }
}

fixDeduplication()
  .then(() => {
    console.log('\n🎉 Fix complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
