#!/usr/bin/env npx tsx
/**
 * Sync resolved positions from pm_trade_fifo_roi_v3 to pm_trade_fifo_roi_v3_mat_unified
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
  console.log('Syncing new resolved positions from v3 to unified...\n');

  // Get current state
  const statsRes = await client.query({
    query: `
      SELECT
        (SELECT count() FROM pm_trade_fifo_roi_v3) as v3_count,
        (SELECT count() FROM pm_trade_fifo_roi_v3_mat_unified) as unified_count,
        (SELECT max(resolved_at) FROM pm_trade_fifo_roi_v3) as v3_latest,
        (SELECT max(resolved_at) FROM pm_trade_fifo_roi_v3_mat_unified) as unified_latest
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsRes.json() as any[])[0];
  console.log('Current state:');
  console.log(`  v3: ${parseInt(stats.v3_count).toLocaleString()} rows, latest: ${stats.v3_latest}`);
  console.log(`  unified: ${parseInt(stats.unified_count).toLocaleString()} rows, latest: ${stats.unified_latest}`);
  console.log(`  Gap: ${(stats.v3_count - stats.unified_count).toLocaleString()} rows\n`);

  // Find conditions in v3 that are newer than unified
  console.log('Finding new conditions to sync...');
  const conditionsRes = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '${stats.unified_latest}'
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 },
  });
  const conditions = (await conditionsRes.json() as {condition_id: string}[]).map(r => r.condition_id);
  console.log(`Found ${conditions.length} conditions to sync\n`);

  if (conditions.length === 0) {
    console.log('Nothing to sync');
    await client.close();
    return;
  }

  // Process in batches
  const BATCH_SIZE = 100;
  let synced = 0;

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);
    const conditionList = batch.map(c => `'${c}'`).join(',');

    console.log(`Syncing batch ${batchNum}/${totalBatches}...`);

    try {
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified
            (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
             resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
             exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
          SELECT
            v.tx_hash, v.order_id, v.wallet, v.condition_id, v.outcome_index,
            v.entry_time, v.resolved_at, v.tokens, v.cost_usd,
            v.tokens_sold_early, v.tokens_held, v.exit_value,
            v.pnl_usd, v.roi, v.pct_sold_early,
            v.is_maker, v.is_closed, v.is_short
          FROM pm_trade_fifo_roi_v3 v
          LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
            ON v.tx_hash = u.tx_hash
            AND v.wallet = u.wallet
            AND v.condition_id = u.condition_id
            AND v.outcome_index = u.outcome_index
          WHERE v.condition_id IN (${conditionList})
            AND u.tx_hash IS NULL
        `,
        clickhouse_settings: { max_execution_time: 300 },
      });

      synced += batch.length;
      console.log(`  Done (${synced}/${conditions.length})`);

    } catch (err: any) {
      console.error(`  Error: ${err.message.substring(0, 100)}`);
    }
  }

  console.log(`\nCompleted! Synced ${synced} conditions`);

  // Run OPTIMIZE to deduplicate
  console.log('\nRunning OPTIMIZE FINAL to deduplicate...');
  try {
    await client.command({
      query: 'OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL',
      clickhouse_settings: { max_execution_time: 600 },
    });
    console.log('  Done');
  } catch (err: any) {
    console.log('  Skipped (may timeout but runs async)');
  }

  // Final stats
  const finalRes = await client.query({
    query: `
      SELECT count() as rows, max(resolved_at) as latest
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const final = (await finalRes.json() as any[])[0];
  console.log(`\nUnified now has ${parseInt(final.rows).toLocaleString()} rows, latest: ${final.latest}`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
