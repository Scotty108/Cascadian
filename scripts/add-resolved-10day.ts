#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function addResolvedPositions() {
  console.log('🔨 Adding Resolved Positions for NEW 10-day Wallets\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  const startTime = Date.now();

  // Step 1: Get count of NEW wallets
  console.log('1️⃣ Counting NEW wallets...');
  const walletCountResult = await clickhouse.query({
    query: `
      SELECT uniq(wallet) as cnt
      FROM pm_trade_fifo_roi_v3_mat_unresolved_new
    `,
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0].cnt;
  console.log(`   ✅ Found ${walletCount.toLocaleString()} NEW wallets\n`);

  // Step 2: Create temp table for NEW wallets
  console.log('2️⃣ Creating temp table for NEW wallets...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS temp_new_wallets_10d` });
  await clickhouse.command({
    query: `CREATE TABLE temp_new_wallets_10d (wallet LowCardinality(String)) ENGINE = Memory`
  });
  await clickhouse.query({
    query: `
      INSERT INTO temp_new_wallets_10d
      SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3_mat_unresolved_new
    `
  });
  console.log(`   ✅ Temp table created\n`);

  // Step 3: Insert resolved positions in 50 batches
  console.log('3️⃣ Inserting resolved positions in 50 batches...');
  const insertStart = Date.now();
  const NUM_BATCHES = 50;

  for (let batch = 0; batch < NUM_BATCHES; batch++) {
    const batchStart = Date.now();
    console.log(`   Batch ${batch + 1}/${NUM_BATCHES}...`);

    await clickhouse.query({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          tx_hash, wallet, condition_id, outcome_index, entry_time,
          resolved_at, cost_usd, tokens, tokens_sold_early, tokens_held,
          exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_short,
          1 as is_closed  -- All resolved positions are closed
        FROM pm_trade_fifo_roi_v3_mat_deduped
        WHERE wallet IN (SELECT wallet FROM temp_new_wallets_10d)
          AND cityHash64(wallet) % ${NUM_BATCHES} = ${batch}
      `,
      request_timeout: 300000,  // 5 minutes per batch
      clickhouse_settings: {
        max_execution_time: 300 as any,
        send_timeout: 300 as any,
        receive_timeout: 300 as any,
      }
    });

    const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    console.log(`      ✅ Batch ${batch + 1} complete (${batchElapsed}s)\n`);
  }

  const insertElapsed = ((Date.now() - insertStart) / 1000 / 60).toFixed(1);
  console.log(`   ✅ All batches done (${insertElapsed} min)\n`);

  // Cleanup temp table
  await clickhouse.command({ query: `DROP TABLE temp_new_wallets_10d` });

  // Step 4: Verification
  console.log('4️⃣ Verifying final production table...\n');
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
  console.log('📊 Final Production Table Stats:');
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

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('='.repeat(60));
  console.log(`✅ 10-Day Production Table Complete! (${totalElapsed} min total)\n`);
  console.log('📋 Table: pm_trade_fifo_roi_v3_mat_unified');
  console.log(`📊 Rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`👥 Wallets: ${stats.unique_wallets.toLocaleString()}\n`);
  console.log('🎉 Ready for leaderboard queries!');
  console.log('   npx tsx scripts/analysis/hyperdiversified-2day.ts\n');
  console.log('='.repeat(60) + '\n');
}

addResolvedPositions().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
