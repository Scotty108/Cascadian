#!/usr/bin/env npx tsx
/**
 * Merge and Deduplicate Unified Tables
 *
 * Strategy: Insert ALL data from old table into new table, then deduplicate
 * This avoids expensive LEFT JOIN operations that hit memory limits
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function mergeAndDedupe() {
  console.log('🔄 Merging Old and New Tables\n');

  // Step 1: Copy ALL resolved data from old table to new table (will create duplicates)
  console.log('1️⃣  Copying all resolved data from old table...');
  const startCopy = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_v2
      SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour
    }
  });

  const copyElapsed = ((Date.now() - startCopy) / 1000 / 60).toFixed(1);
  console.log(`✅ Copy complete! (${copyElapsed} minutes)\n`);

  // Step 2: Create deduplicated table
  console.log('2️⃣  Creating deduplicated table...');
  const startDedupe = Date.now();

  // Drop old dedup table if exists
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_deduped`
  });

  // Create new deduped table
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_deduped
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      AS
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
        any(is_maker) as is_maker,
        any(is_short) as is_short,
        any(is_closed) as is_closed
      FROM pm_trade_fifo_roi_v3_mat_unified_v2
      GROUP BY tx_hash, wallet, condition_id, outcome_index
    `,
    clickhouse_settings: {
      max_execution_time: 3600, // 1 hour
    }
  });

  const dedupeElapsed = ((Date.now() - startDedupe) / 1000 / 60).toFixed(1);
  console.log(`✅ Deduplication complete! (${dedupeElapsed} minutes)\n`);

  // Step 3: Verify final table
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as stale_min,
        uniq(wallet) as wallets
      FROM pm_trade_fifo_roi_v3_mat_unified_deduped
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  console.log('📊 FINAL DEDUPLICATED TABLE:');
  console.log(`   Total rows: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Unique wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Newest resolved: ${final.newest_resolved}`);
  console.log(`   Staleness: ${final.stale_min} minutes\n`);

  console.log('✅ Ready to swap tables!');
  console.log('   Run: npx tsx scripts/swap-unified-tables.ts');
}

mergeAndDedupe().catch(console.error);
