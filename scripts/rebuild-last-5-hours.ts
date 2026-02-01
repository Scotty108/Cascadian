#!/usr/bin/env npx tsx
/**
 * PHASE 2: Last 5 Hours Test
 *
 * TRUE FIFO V5: Multiple rows per position (one per buy transaction)
 * GROUP BY (tx_hash, wallet, condition_id, outcome_index)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function rebuildLast5Hours() {
  const startTime = Date.now();
  console.log('🔨 PHASE 2: Last 5 Hours (TRUE FIFO V5)\n');

  // Step 1: Drop and recreate table
  console.log('1️⃣ Recreating table...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_deduped`
  });

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

  // Step 2: Find active wallets
  console.log('2️⃣ Finding active wallets (last 5 hours)...');
  await clickhouse.command({
    query: `CREATE TABLE IF NOT EXISTS temp_active_wallets_5h (wallet LowCardinality(String)) ENGINE = Memory`
  });
  await clickhouse.command({ query: 'TRUNCATE TABLE temp_active_wallets_5h' });
  await clickhouse.query({
    query: `INSERT INTO temp_active_wallets_5h SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3 WHERE entry_time >= now() - INTERVAL 5 HOUR`
  });

  const walletCountResult = await clickhouse.query({
    query: 'SELECT count() FROM temp_active_wallets_5h',
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0]['count()'];
  console.log(`   ✅ Found ${walletCount.toLocaleString()} active wallets\n`);

  // Step 3: Insert in 50 batches (smaller dataset)
  const numBatches = 50;
  console.log(`3️⃣ Inserting FULL HISTORY for active wallets (${numBatches} batches)...\n`);
  console.log(`   🔑 GROUP BY: (tx_hash, wallet, condition_id, outcome_index)`);
  console.log(`   📋 TRUE FIFO V5: Multiple rows per position (one per buy tx)\n`);

  for (let i = 0; i < numBatches; i++) {
    console.log(`   Batch ${i + 1}/${numBatches}...`);

    const batchStart = Date.now();
    await clickhouse.query({
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
          any(is_short) as is_short
        FROM pm_trade_fifo_roi_v3 f
        INNER JOIN temp_active_wallets_5h w ON f.wallet = w.wallet
        WHERE cityHash64(f.tx_hash) % ${numBatches} = ${i}
        GROUP BY tx_hash, wallet, condition_id, outcome_index
      `,
      request_timeout: 600000,
      clickhouse_settings: {
        max_execution_time: 600 as any,
        max_memory_usage: 10000000000 as any,
      }
    });

    const elapsed = ((Date.now() - batchStart) / 1000).toFixed(1);

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
  await clickhouse.command({ query: 'DROP TABLE temp_active_wallets_5h' });

  // Step 4: Verification
  console.log('4️⃣ Verification...\n');

  const totalResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_deduped`,
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].total;

  const uniqueResult = await clickhouse.query({
    query: `SELECT uniq(tx_hash, wallet, condition_id, outcome_index) as unique_keys FROM pm_trade_fifo_roi_v3_mat_deduped`,
    format: 'JSONEachRow'
  });
  const unique = (await uniqueResult.json())[0].unique_keys;

  const walletsResult = await clickhouse.query({
    query: `SELECT uniq(wallet) as wallets FROM pm_trade_fifo_roi_v3_mat_deduped`,
    format: 'JSONEachRow'
  });
  const wallets = (await walletsResult.json())[0].wallets;

  console.log(`   Total rows: ${total.toLocaleString()}`);
  console.log(`   Unique keys: ${unique.toLocaleString()}`);
  console.log(`   Duplicates: ${(total - unique).toLocaleString()}`);
  console.log(`   Wallets: ${wallets.toLocaleString()}\n`);

  if (total === unique) {
    console.log('   ✅ ZERO DUPLICATES!\n');
  } else {
    console.log(`   ❌ WARNING: ${(total - unique).toLocaleString()} duplicates remain!\n`);
  }

  // Step 5: FIFO V5 logic check
  console.log('5️⃣ FIFO V5 Logic Check (multiple rows per position)...');
  const fifoResult = await clickhouse.query({
    query: `
      SELECT
        wallet, condition_id, outcome_index,
        count() as buy_transactions,
        sum(pnl_usd) as position_pnl
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE abs(cost_usd) >= 10
      GROUP BY wallet, condition_id, outcome_index
      HAVING count() > 1
      ORDER BY count() DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const fifoData = await fifoResult.json();

  if (fifoData.length > 0) {
    console.log(`   ✅ TRUE FIFO V5 preserved: Found ${fifoData.length} positions with multiple buy transactions`);
    console.log(`      Top position: ${fifoData[0].buy_transactions} buy txs, $${fifoData[0].position_pnl.toFixed(2)} PnL\n`);
  } else {
    console.log('   ℹ️  No positions with multiple buy transactions found\n');
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('═'.repeat(60));
  console.log(`✅ PHASE 2 COMPLETE in ${totalTime} minutes`);
  console.log(`\n📊 Results:`);
  console.log(`   - Rows: ${total.toLocaleString()}`);
  console.log(`   - Wallets: ${wallets.toLocaleString()}`);
  console.log(`   - Duplicates: ${(total - unique).toLocaleString()}`);

  if (total === unique) {
    console.log(`\n✅ READY FOR PHASE 3: Full overnight backfill`);
  } else {
    console.log(`\n❌ FIX NEEDED: Still have duplicates`);
  }
  console.log('═'.repeat(60));
}

rebuildLast5Hours()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
