/**
 * Backfill unresolved positions into pm_trade_fifo_roi_v3_mat_unified.
 *
 * The unified table was originally populated only from pm_trade_fifo_roi_v3 (resolved only).
 * Due to ClickHouse's join_use_nulls=0 default, LEFT JOIN ... IS NULL anti-join patterns
 * silently returned 0 rows, so the incremental cron never added unresolved positions.
 *
 * This script backfills all ~11K unresolved conditions (LONG + SHORT positions).
 *
 * No anti-join needed: unified table currently has ZERO unresolved rows.
 * SharedReplacingMergeTree deduplicates on merge anyway (ORDER BY wallet, condition_id, outcome_index, tx_hash).
 *
 * Pre-requisite: Run via MCP first:
 *   CREATE TABLE IF NOT EXISTS temp_unresolved_conditions (condition_id String) ENGINE = Memory;
 *   INSERT INTO temp_unresolved_conditions SELECT ... (see getUnresolvedConditions for query)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const QUERY_SETTINGS = {
  max_execution_time: 300,
  max_memory_usage: 10_000_000_000,
  join_use_nulls: 1,
} as Record<string, any>;

const BATCH_SIZE = 20; // conditions per batch

async function getUnresolvedConditions(): Promise<string[]> {
  const result = await clickhouse.query({
    query: `SELECT condition_id FROM temp_unresolved_conditions`,
    format: 'JSONEachRow',
    clickhouse_settings: QUERY_SETTINGS,
  });
  const rows = (await result.json()) as { condition_id: string }[];
  return rows.map(r => r.condition_id);
}

async function insertLongPositions(conditionList: string): Promise<void> {
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
         resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
         exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
      SELECT
        tx_hash, order_id, wallet, condition_id, outcome_index,
        entry_time,
        toDateTime('1970-01-01 00:00:00') as resolved_at,
        tokens, cost_usd,
        0 as tokens_sold_early, tokens as tokens_held,
        0 as exit_value, 0 as pnl_usd, 0 as roi, 0 as pct_sold_early,
        is_maker_flag as is_maker, 0 as is_closed, 0 as is_short
      FROM (
        SELECT
          _tx_hash as tx_hash, any(_order_id) as order_id, _wallet as wallet,
          _condition_id as condition_id, _outcome_index as outcome_index,
          min(_event_time) as entry_time, sum(_tokens_delta) as tokens,
          sum(abs(_usdc_delta)) as cost_usd, max(_is_maker) as is_maker_flag
        FROM (
          SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time,
            any(wallet) as _wallet, any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta, any(is_maker) as _is_maker,
            any(is_self_fill) as _is_self_fill,
            splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
          FROM pm_canonical_fills_v4
          WHERE condition_id IN (${conditionList}) AND source = 'clob'
          GROUP BY fill_id
        )
        WHERE _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (_is_self_fill = 1 AND _is_maker = 1)
        GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
        HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
      )
    `,
    clickhouse_settings: QUERY_SETTINGS,
  });
}

async function insertShortPositions(conditionList: string): Promise<void> {
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
         resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
         exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
      SELECT
        tx_hash, order_id, wallet, condition_id, outcome_index,
        entry_time,
        toDateTime('1970-01-01 00:00:00') as resolved_at,
        tokens, cost_usd,
        0 as tokens_sold_early, tokens as tokens_held,
        0 as exit_value, 0 as pnl_usd, 0 as roi, 0 as pct_sold_early,
        0 as is_maker, 0 as is_closed, 1 as is_short
      FROM (
        SELECT
          concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index), '_', toString(toUnixTimestamp(entry_time))) as tx_hash,
          any_order_id as order_id,
          wallet, condition_id, outcome_index, entry_time,
          abs(net_tokens) as tokens, abs(cash_flow) as cost_usd
        FROM (
          SELECT
            fills._wallet as wallet, fills._condition_id as condition_id,
            fills._outcome_index as outcome_index, min(fills._event_time) as entry_time,
            sum(fills._tokens_delta) as net_tokens, sum(fills._usdc_delta) as cash_flow,
            any(fills._order_id) as any_order_id
          FROM (
            SELECT fill_id, any(event_time) as _event_time, any(wallet) as _wallet,
              any(condition_id) as _condition_id, any(outcome_index) as _outcome_index,
              any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
              any(source) as _source, any(is_self_fill) as _is_self_fill, any(is_maker) as _is_maker,
              splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (${conditionList}) AND source = 'clob'
            GROUP BY fill_id
          ) AS fills
          WHERE fills._source = 'clob' AND fills._wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (fills._is_self_fill = 1 AND fills._is_maker = 1)
          GROUP BY fills._wallet, fills._condition_id, fills._outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
        )
      )
    `,
    clickhouse_settings: QUERY_SETTINGS,
  });
}

async function main() {
  console.log('=== Backfill unresolved positions into unified table ===\n');

  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at <= '1970-01-01 00:00:00') as unresolved,
        countIf(resolved_at > '1970-01-01') as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
    clickhouse_settings: QUERY_SETTINGS,
  });
  const before = (await beforeResult.json() as any[])[0];
  console.log(`BEFORE: total=${Number(before.total).toLocaleString()}, resolved=${Number(before.resolved).toLocaleString()}, unresolved=${Number(before.unresolved).toLocaleString()}\n`);

  console.log('Finding unresolved conditions...');
  const conditions = await getUnresolvedConditions();
  console.log(`Found ${conditions.length} unresolved conditions to backfill\n`);

  if (conditions.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const startTime = Date.now();
  let completed = 0;
  let errors = 0;
  const totalBatches = Math.ceil(conditions.length / BATCH_SIZE);

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map(id => `'${id}'`).join(',');
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await insertLongPositions(conditionList);
      await insertShortPositions(conditionList);
      completed += batch.length;
    } catch (err: any) {
      errors++;
      console.error(`  ERROR batch ${batchNum}: ${err.message?.slice(0, 200)}`);
    }

    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = completed > 0 ? (completed / ((Date.now() - startTime) / 1000)).toFixed(1) : '0';
      const eta = parseFloat(rate) > 0 ? ((conditions.length - completed) / parseFloat(rate)).toFixed(0) : '?';
      console.log(`  Progress: ${batchNum}/${totalBatches} batches (${completed}/${conditions.length} conditions) - ${elapsed}s elapsed, ~${eta}s remaining${errors ? `, ${errors} errors` : ''}`);
    }
  }

  console.log('\nBackfill complete. Waiting 5s for async inserts to flush...');
  await new Promise(r => setTimeout(r, 5000));

  const afterResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at <= '1970-01-01 00:00:00') as unresolved,
        countIf(resolved_at > '1970-01-01') as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
    clickhouse_settings: QUERY_SETTINGS,
  });
  const after = (await afterResult.json() as any[])[0];

  console.log('\n=== RESULTS ===');
  console.log(`BEFORE: total=${Number(before.total).toLocaleString()}, resolved=${Number(before.resolved).toLocaleString()}, unresolved=${Number(before.unresolved).toLocaleString()}`);
  console.log(`AFTER:  total=${Number(after.total).toLocaleString()}, resolved=${Number(after.resolved).toLocaleString()}, unresolved=${Number(after.unresolved).toLocaleString()}`);
  console.log(`ADDED:  ${(Number(after.total) - Number(before.total)).toLocaleString()} new rows (${(Number(after.unresolved) - Number(before.unresolved)).toLocaleString()} unresolved)`);
  console.log(`Errors: ${errors}`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
