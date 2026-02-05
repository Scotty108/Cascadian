#!/usr/bin/env npx tsx
/**
 * Process pending FIFO positions for recently resolved conditions
 * Batched version: gets list of conditions with fills first, then processes in batches
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
  console.log('Finding conditions with CLOB fills resolved after Feb 3...\n');

  // Get conditions that have CLOB fills AND are resolved after Feb 3
  const result = await client.query({
    query: `
      SELECT DISTINCT
        r.condition_id,
        r.resolved_at,
        r.payout_numerators
      FROM pm_condition_resolutions r
      WHERE r.is_deleted = 0
        AND r.payout_numerators != ''
        AND r.resolved_at > '2026-02-03 20:00:00'
        AND r.condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
          WHERE resolved_at > '2026-02-03 20:00:00'
        )
        AND EXISTS (
          SELECT 1 FROM pm_canonical_fills_v4 f
          WHERE f.condition_id = r.condition_id AND f.source = 'clob'
          LIMIT 1
        )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });

  const conditions = await result.json() as {condition_id: string, resolved_at: string, payout_numerators: string}[];
  console.log(`Found ${conditions.length} conditions to process\n`);

  if (conditions.length === 0) {
    console.log('Nothing to process');
    await client.close();
    return;
  }

  // Process in batches of 20
  const BATCH_SIZE = 20;
  let processed = 0;
  let totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const conditionList = batch.map(c => `'${c.condition_id}'`).join(',');

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} conditions)...`);

    try {
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3
          SELECT
            tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
            tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
            pnl_usd, roi, pct_sold_early, is_maker, resolved_at, is_short, is_closed
          FROM (
            SELECT
              deduped._tx_hash as tx_hash,
              any(deduped._order_id) as order_id,
              deduped._wallet as wallet,
              deduped._condition_id as condition_id,
              deduped._outcome_index as outcome_index,
              min(deduped._event_time) as entry_time,
              sum(deduped._tokens_delta) as tokens,
              sum(abs(deduped._usdc_delta)) as cost_usd,
              0 as tokens_sold_early,
              sum(deduped._tokens_delta) as tokens_held,
              CASE
                WHEN arrayElement(splitByChar(',', r.payout_numerators), toUInt8(deduped._outcome_index) + 1) = '1000000000000000000'
                THEN sum(deduped._tokens_delta)
                ELSE 0
              END as exit_value,
              CASE
                WHEN arrayElement(splitByChar(',', r.payout_numerators), toUInt8(deduped._outcome_index) + 1) = '1000000000000000000'
                THEN sum(deduped._tokens_delta) - sum(abs(deduped._usdc_delta))
                ELSE -sum(abs(deduped._usdc_delta))
              END as pnl_usd,
              CASE
                WHEN sum(abs(deduped._usdc_delta)) > 0.01
                THEN (CASE
                  WHEN arrayElement(splitByChar(',', r.payout_numerators), toUInt8(deduped._outcome_index) + 1) = '1000000000000000000'
                  THEN (sum(deduped._tokens_delta) - sum(abs(deduped._usdc_delta))) / sum(abs(deduped._usdc_delta))
                  ELSE -1
                END)
                ELSE 0
              END as roi,
              0 as pct_sold_early,
              max(deduped._is_maker) as is_maker,
              r.resolved_at as resolved_at,
              0 as is_short,
              1 as is_closed
            FROM (
              SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time,
                any(wallet) as _wallet, any(condition_id) as _condition_id,
                any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
                any(usdc_delta) as _usdc_delta, any(is_maker) as _is_maker,
                any(is_self_fill) as _is_self_fill, any(source) as _source,
                splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList}) AND source = 'clob'
              GROUP BY fill_id
            ) AS deduped
            INNER JOIN pm_condition_resolutions r ON deduped._condition_id = r.condition_id
            WHERE deduped._source = 'clob' AND deduped._tokens_delta > 0
              AND deduped._wallet != '0x0000000000000000000000000000000000000000'
              AND NOT (deduped._is_self_fill = 1 AND deduped._is_maker = 1)
              AND r.is_deleted = 0 AND r.payout_numerators != ''
            GROUP BY deduped._tx_hash, deduped._wallet, deduped._condition_id, deduped._outcome_index, r.resolved_at, r.payout_numerators
            HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
          )
        `,
        clickhouse_settings: { max_execution_time: 300 },
      });

      processed += batch.length;
      console.log(`  Done (total processed: ${processed}/${conditions.length})`);

    } catch (err: any) {
      console.error(`  Error in batch: ${err.message.substring(0, 100)}`);
    }
  }

  console.log(`\nCompleted! Processed ${processed} conditions`);

  const stats = await client.query({
    query: `SELECT count() as total, max(resolved_at) as latest FROM pm_trade_fifo_roi_v3`,
    format: 'JSONEachRow',
  });
  const s = (await stats.json() as any[])[0];
  console.log(`\nv3 now has ${parseInt(s.total).toLocaleString()} rows, latest resolution: ${s.latest}`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
