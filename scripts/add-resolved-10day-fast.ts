#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function addResolvedFast() {
  console.log('🔨 Adding Resolved Positions for NEW 10-day Wallets (FAST)\n');
  console.log('⏰ Started at:', new Date().toLocaleString());
  const startTime = Date.now();

  // Step 1: Create temp table with NEW wallets
  console.log('1️⃣ Creating temp table for NEW wallets...');
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

  const walletCountResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM temp_new_wallets_10d`,
    format: 'JSONEachRow'
  });
  const walletCount = (await walletCountResult.json())[0].cnt;
  console.log(`   ✅ Created temp table with ${walletCount.toLocaleString()} wallets\n`);

  // Step 2: Insert with INNER JOIN (single query, much faster)
  console.log('2️⃣ Inserting resolved positions via INNER JOIN...');
  const insertStart = Date.now();

  await clickhouse.query({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      SELECT
        d.tx_hash, d.wallet, d.condition_id, d.outcome_index, d.entry_time,
        d.resolved_at, d.cost_usd, d.tokens, d.tokens_sold_early, d.tokens_held,
        d.exit_value, d.pnl_usd, d.roi, d.pct_sold_early, d.is_maker, d.is_short,
        1 as is_closed  -- All resolved positions are closed
      FROM pm_trade_fifo_roi_v3_mat_deduped d
      INNER JOIN temp_new_wallets_10d w ON d.wallet = w.wallet
    `,
    request_timeout: 1800000,  // 30 minutes
    clickhouse_settings: {
      max_execution_time: 1800 as any,
      max_memory_usage: 30000000000 as any,  // 30GB
      send_timeout: 1800 as any,
      receive_timeout: 1800 as any,
    }
  });

  const insertElapsed = ((Date.now() - insertStart) / 1000 / 60).toFixed(1);
  console.log(`   ✅ Done (${insertElapsed} min)\n`);

  // Step 3: Cleanup
  await clickhouse.command({ query: `DROP TABLE temp_new_wallets_10d` });

  // Step 4: Verification
  console.log('3️⃣ Verifying final production table...\n');
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

addResolvedFast().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
