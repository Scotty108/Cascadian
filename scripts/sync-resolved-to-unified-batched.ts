#!/usr/bin/env npx tsx
/**
 * Sync resolved positions from pm_trade_fifo_roi_v3 to unified table
 * Uses batched approach to avoid memory limits
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const BATCH_SIZE = 5000;

async function syncResolved() {
  console.log('🔄 Syncing resolved positions to unified table...\n');
  const startTime = Date.now();

  // Get the latest resolved_at in unified table
  const latestResult = await clickhouse.query({
    query: `SELECT max(resolved_at) as latest FROM pm_trade_fifo_roi_v3_mat_unified WHERE resolved_at IS NOT NULL`,
    format: 'JSONEachRow'
  });
  const latest = ((await latestResult.json()) as any)[0].latest;
  console.log(`   Latest in unified: ${latest}`);

  // Get count of positions to sync
  const countResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '${latest}'
    `,
    format: 'JSONEachRow'
  });
  const totalToSync = ((await countResult.json()) as any)[0].cnt;
  console.log(`   Positions to sync: ${totalToSync.toLocaleString()}\n`);

  if (totalToSync === 0) {
    console.log('✅ Already in sync!');
    return;
  }

  // Get distinct conditions to process
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '${latest}'
    `,
    format: 'JSONEachRow'
  });
  const conditions = ((await conditionsResult.json()) as { condition_id: string }[]).map(r => r.condition_id);
  console.log(`   Conditions to process: ${conditions.length}\n`);

  const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);
  let synced = 0;

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map(id => `'${id}'`).join(',');
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          tx_hash, wallet, condition_id, outcome_index,
          entry_time, resolved_at, tokens, cost_usd,
          tokens_sold_early, tokens_held, exit_value,
          pnl_usd, roi, pct_sold_early,
          is_maker, is_closed, is_short
        FROM pm_trade_fifo_roi_v3
        WHERE condition_id IN (${conditionList})
          AND resolved_at > '${latest}'
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });

    synced += batch.length;
    if (batchNum % 5 === 0 || batchNum === totalBatches) {
      console.log(`   Batch ${batchNum}/${totalBatches} - ${synced} conditions synced`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Check new state
  const newLatest = await clickhouse.query({
    query: `SELECT max(resolved_at) as newest FROM pm_trade_fifo_roi_v3_mat_unified WHERE resolved_at IS NOT NULL`,
    format: 'JSONEachRow'
  });
  const newest = ((await newLatest.json()) as any)[0].newest;

  console.log(`\n✅ Sync complete! (${elapsed} min)`);
  console.log(`   Conditions synced: ${synced}`);
  console.log(`   Newest resolved in unified: ${newest}`);
}

syncResolved().catch(console.error);
