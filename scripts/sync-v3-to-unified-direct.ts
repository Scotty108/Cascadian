#!/usr/bin/env npx tsx
/**
 * Direct sync of resolved positions from v3 to unified
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 600000,
});

async function main() {
  console.log('Direct sync: v3 -> unified\n');

  // Check starting state
  const before = await client.query({
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: 'JSONEachRow',
  });
  const beforeCount = (await before.json() as any[])[0].cnt;
  console.log(`Unified before: ${parseInt(beforeCount).toLocaleString()} rows`);

  // Get list of conditions to sync
  const condRes = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '2026-02-03 20:00:00'
    `,
    format: 'JSONEachRow',
  });
  const conditions = (await condRes.json() as {condition_id: string}[]).map(r => r.condition_id);
  console.log(`Conditions to sync: ${conditions.length}`);

  // Sync in batches - simple INSERT without anti-join
  // Unified is ReplacingMergeTree, so duplicates will be deduped
  const BATCH_SIZE = 50;
  let total = 0;

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const condList = batch.map(c => `'${c}'`).join(',');
    const batchNum = Math.floor(i/BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches}...`);

    try {
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified
            (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
             resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
             exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
          SELECT
            tx_hash, order_id, wallet, condition_id, outcome_index,
            entry_time, resolved_at, tokens, cost_usd,
            tokens_sold_early, tokens_held, exit_value,
            pnl_usd, roi, pct_sold_early,
            is_maker, is_closed, is_short
          FROM pm_trade_fifo_roi_v3
          WHERE condition_id IN (${condList})
        `,
        clickhouse_settings: { max_execution_time: 300 },
      });
      total += batch.length;
      console.log(`  Done (${total}/${conditions.length})`);
    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
    }
  }

  // Check after state
  const after = await client.query({
    query: `SELECT count() as cnt, max(resolved_at) as latest FROM pm_trade_fifo_roi_v3_mat_unified`,
    format: 'JSONEachRow',
  });
  const afterData = (await after.json() as any[])[0];
  console.log(`\nUnified after: ${parseInt(afterData.cnt).toLocaleString()} rows, latest: ${afterData.latest}`);
  console.log(`Added: ${(afterData.cnt - beforeCount).toLocaleString()} rows`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
