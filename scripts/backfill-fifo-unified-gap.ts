#!/usr/bin/env npx tsx
/**
 * Backfill FIFO Unified Gap
 *
 * Syncs all entries from pm_trade_fifo_roi_v3 that are missing from pm_trade_fifo_roi_v3_mat_unified.
 *
 * Root cause: The incremental sync only processed entries where resolved_at > latest_unified,
 * missing ~45K wallets with historical resolutions.
 *
 * Strategy:
 * 1. Find wallets in v3 but not in unified (45K wallets)
 * 2. Process in batches to avoid memory issues
 * 3. Insert missing entries with anti-join
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST?.startsWith('http')
    ? process.env.CLICKHOUSE_HOST
    : `https://${process.env.CLICKHOUSE_HOST}:8443`,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

const BATCH_SIZE = 1000; // wallets per batch

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({
    query: sql,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  return result.json();
}

async function execute(sql: string): Promise<void> {
  await client.command({
    query: sql,
    clickhouse_settings: { max_execution_time: 600 }
  });
}

async function getMissingWallets(): Promise<string[]> {
  console.log('Finding wallets in v3 but not in unified...');

  const result = await query<{ wallet: string }>(`
    SELECT DISTINCT wallet
    FROM pm_trade_fifo_roi_v3
    WHERE wallet NOT IN (
      SELECT DISTINCT wallet FROM pm_trade_fifo_roi_v3_mat_unified
    )
  `);

  return result.map(r => r.wallet);
}

async function backfillWalletBatch(wallets: string[]): Promise<number> {
  const walletList = wallets.map(w => `'${w}'`).join(',');

  // Count entries to insert (for logging)
  const countResult = await query<{ cnt: number }>(`
    SELECT count() as cnt FROM pm_trade_fifo_roi_v3 WHERE wallet IN (${walletList})
  `);
  const toInsert = countResult[0]?.cnt || 0;

  // Insert all v3 entries for these wallets
  // Since we only process wallets that are completely missing from unified,
  // we don't need an anti-join (it would be expensive and unnecessary)
  // IMPORTANT: Use explicit column names to prevent column order bugs
  // (v3 and unified tables have different column orders)
  await execute(`
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      (tx_hash, wallet, condition_id, outcome_index, entry_time,
       resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
       exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
    SELECT
      v.tx_hash,
      v.wallet,
      v.condition_id,
      v.outcome_index,
      v.entry_time,
      v.resolved_at,
      v.tokens,
      v.cost_usd,
      v.tokens_sold_early,
      v.tokens_held,
      v.exit_value,
      v.pnl_usd,
      v.roi,
      v.pct_sold_early,
      v.is_maker,
      CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
      v.is_short
    FROM pm_trade_fifo_roi_v3 v
    WHERE v.wallet IN (${walletList})
  `);

  return toInsert;
}

async function getStats() {
  const result = await query<{
    v3_entries: number;
    v3_wallets: number;
    unified_entries: number;
    unified_wallets: number;
  }>(`
    SELECT
      (SELECT count() FROM pm_trade_fifo_roi_v3) as v3_entries,
      (SELECT uniqExact(wallet) FROM pm_trade_fifo_roi_v3) as v3_wallets,
      (SELECT count() FROM pm_trade_fifo_roi_v3_mat_unified) as unified_entries,
      (SELECT uniqExact(wallet) FROM pm_trade_fifo_roi_v3_mat_unified) as unified_wallets
  `);
  return result[0];
}

async function main() {
  console.log('=== FIFO Unified Gap Backfill ===\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Get initial stats
  console.log('Initial stats:');
  const initialStats = await getStats();
  console.log(`  v3: ${initialStats.v3_entries.toLocaleString()} entries, ${initialStats.v3_wallets.toLocaleString()} wallets`);
  console.log(`  unified: ${initialStats.unified_entries.toLocaleString()} entries, ${initialStats.unified_wallets.toLocaleString()} wallets`);
  console.log(`  gap: ${(initialStats.v3_wallets - initialStats.unified_wallets).toLocaleString()} wallets\n`);

  // Get missing wallets
  const missingWallets = await getMissingWallets();
  console.log(`Found ${missingWallets.length.toLocaleString()} wallets to backfill\n`);

  if (missingWallets.length === 0) {
    console.log('No missing wallets found. Unified table is in sync with v3.');
    await client.close();
    return;
  }

  // Process in batches
  let totalInserted = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(missingWallets.length / BATCH_SIZE);

  for (let i = 0; i < missingWallets.length; i += BATCH_SIZE) {
    batchNum++;
    const batch = missingWallets.slice(i, i + BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches}: Processing ${batch.length} wallets...`);

    try {
      const inserted = await backfillWalletBatch(batch);
      totalInserted += inserted;
      console.log(`  ✓ Inserted ${inserted.toLocaleString()} entries (total: ${totalInserted.toLocaleString()})`);
    } catch (err: any) {
      console.error(`  ✗ Error: ${err.message}`);
    }
  }

  // Get final stats
  console.log('\nFinal stats:');
  const finalStats = await getStats();
  console.log(`  v3: ${finalStats.v3_entries.toLocaleString()} entries, ${finalStats.v3_wallets.toLocaleString()} wallets`);
  console.log(`  unified: ${finalStats.unified_entries.toLocaleString()} entries, ${finalStats.unified_wallets.toLocaleString()} wallets`);
  console.log(`  remaining gap: ${(finalStats.v3_wallets - finalStats.unified_wallets).toLocaleString()} wallets`);

  console.log(`\n=== Backfill Complete ===`);
  console.log(`Total entries inserted: ${totalInserted.toLocaleString()}`);
  console.log(`Completed at: ${new Date().toISOString()}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
