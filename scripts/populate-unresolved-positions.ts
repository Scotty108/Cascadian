#!/usr/bin/env npx tsx
/**
 * Populate unresolved positions in pm_trade_fifo_roi_v3_mat_unified
 * These are positions for markets that haven't resolved yet
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
  console.log('Populating unresolved positions in unified table...\n');

  // Get count of unresolved conditions
  const countRes = await client.query({
    query: `
      SELECT count(DISTINCT condition_id) as cnt
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
    `,
    format: 'JSONEachRow',
  });
  const totalConditions = (await countRes.json() as any[])[0].cnt;
  console.log(`Found ${totalConditions.toLocaleString()} unresolved conditions with trades\n`);

  // Get list of unresolved conditions
  const condRes = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const conditions = (await condRes.json() as {condition_id: string}[]).map(r => r.condition_id);

  // Process in batches
  const BATCH_SIZE = 100;
  let processed = 0;
  const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const condList = batch.map(c => `'${c}'`).join(',');

    if (batchNum % 10 === 1 || batchNum === totalBatches) {
      console.log(`Batch ${batchNum}/${totalBatches}...`);
    }

    try {
      // Insert LONG positions (buys > sells = positive token balance)
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified
            (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
             resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
             exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
          SELECT
            _tx_hash as tx_hash,
            any(_order_id) as order_id,
            _wallet as wallet,
            _condition_id as condition_id,
            _outcome_index as outcome_index,
            min(_event_time) as entry_time,
            NULL as resolved_at,
            sum(_tokens_delta) as tokens,
            sum(abs(_usdc_delta)) as cost_usd,
            0 as tokens_sold_early,
            sum(_tokens_delta) as tokens_held,
            0 as exit_value,
            0 as pnl_usd,
            0 as roi,
            0 as pct_sold_early,
            max(_is_maker) as is_maker,
            0 as is_closed,
            0 as is_short
          FROM (
            SELECT
              fill_id,
              any(tx_hash) as _tx_hash,
              any(event_time) as _event_time,
              any(wallet) as _wallet,
              any(condition_id) as _condition_id,
              any(outcome_index) as _outcome_index,
              any(tokens_delta) as _tokens_delta,
              any(usdc_delta) as _usdc_delta,
              any(is_maker) as _is_maker,
              any(is_self_fill) as _is_self_fill,
              splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (${condList})
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE _tokens_delta > 0
            AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
        `,
        clickhouse_settings: { max_execution_time: 300 },
      });

      processed += batch.length;

    } catch (err: any) {
      console.error(`  Error batch ${batchNum}: ${err.message.substring(0, 80)}`);
    }
  }

  console.log(`\nProcessed ${processed} conditions`);

  // Check result
  const afterRes = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NULL) as unresolved,
        countIf(resolved_at IS NOT NULL) as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const after = (await afterRes.json() as any[])[0];
  console.log(`\nUnified table now:`);
  console.log(`  Total: ${parseInt(after.total).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(after.resolved).toLocaleString()}`);
  console.log(`  Unresolved: ${parseInt(after.unresolved).toLocaleString()}`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
