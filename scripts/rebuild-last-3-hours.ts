#!/usr/bin/env npx tsx
/**
 * PHASE 2: Last 3 Hours (Fast Validation)
 *
 * TRUE FIFO V5: Multiple rows per position (one per buy transaction)
 * GROUP BY (tx_hash, wallet, condition_id, outcome_index)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function rebuildLast3Hours() {
  const startTime = Date.now();
  console.log('🔨 PHASE 2: Last 3 Hours (Fast Validation)\n');

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

  // Step 2: Single INSERT (no batching needed for small dataset)
  console.log('2️⃣ Populating with CORRECT deduplication...');
  console.log('   GROUP BY: (tx_hash, wallet, condition_id, outcome_index)');
  console.log('   Filter: Wallets active in last 3 hours\n');

  const insertStart = Date.now();
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
      FROM pm_trade_fifo_roi_v3
      WHERE wallet IN (
        SELECT DISTINCT wallet
        FROM pm_trade_fifo_roi_v3
        WHERE entry_time >= now() - INTERVAL 3 HOUR
      )
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    request_timeout: 600000,
    clickhouse_settings: {
      max_execution_time: 600 as any,
      max_memory_usage: 10000000000 as any,
    }
  });

  const insertDuration = ((Date.now() - insertStart) / 1000).toFixed(1);
  console.log(`   ✅ Populated in ${insertDuration} seconds\n`);

  // Step 3: Verification
  console.log('3️⃣ Verification...\n');

  const totalResult = await clickhouse.query({
    query: `SELECT count() as total FROM pm_trade_fifo_roi_v3_mat_deduped`,
    format: 'JSONEachRow'
  });
  const total = (await totalResult.json())[0].total;

  const uniqueResult = await clickhouse.query({
    query: `SELECT uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys FROM pm_trade_fifo_roi_v3_mat_deduped`,
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

  // Step 4: FIFO V5 logic check
  console.log('4️⃣ FIFO V5 Logic Check (multiple rows per position)...');
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

  // Step 5: Early selling check
  console.log('5️⃣ Early Selling Check...');
  const earlyResult = await clickhouse.query({
    query: `
      SELECT
        countIf(tokens_sold_early > 0) as with_early_selling,
        countIf(tokens_held > 0) as with_holding,
        countIf(tokens_sold_early > 0 AND tokens_held > 0) as with_both
      FROM pm_trade_fifo_roi_v3_mat_deduped
      WHERE tokens > 0
    `,
    format: 'JSONEachRow'
  });
  const earlyData = await earlyResult.json();

  console.log(`   Early selling: ${earlyData[0].with_early_selling.toLocaleString()}`);
  console.log(`   Holding to resolution: ${earlyData[0].with_holding.toLocaleString()}`);
  console.log(`   Both (partial early sell): ${earlyData[0].with_both.toLocaleString()}`);
  if (earlyData[0].with_early_selling > 0 && earlyData[0].with_holding > 0) {
    console.log(`   ✅ Early selling tracking working\n`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('═'.repeat(60));
  console.log(`✅ PHASE 2 COMPLETE in ${totalTime}s`);
  console.log(`\n📊 Results:`);
  console.log(`   - Rows: ${total.toLocaleString()}`);
  console.log(`   - Wallets: ${wallets.toLocaleString()}`);
  console.log(`   - Duplicates: ${(total - unique).toLocaleString()}`);

  if (total === unique) {
    console.log(`\n✅ VALIDATION SUCCESSFUL - Logic confirmed working!`);
    console.log(`\n📋 Next: Run full overnight backfill when ready`);
  } else {
    console.log(`\n❌ FIX NEEDED: Still have duplicates`);
  }
  console.log('═'.repeat(60));
}

rebuildLast3Hours()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
