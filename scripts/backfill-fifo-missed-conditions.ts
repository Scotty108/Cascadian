#!/usr/bin/env npx tsx
/**
 * Backfill FIFO Missed Conditions
 *
 * Processes all resolved conditions that are NOT yet in pm_trade_fifo_roi_v3.
 * The refresh-fifo-trades cron has a 48h lookback window, which means conditions
 * that resolved during outages or recovery periods get permanently missed.
 *
 * This script uses the SAME SQL logic as the cron (long + short positions)
 * but processes ALL missed conditions regardless of when they resolved.
 *
 * Usage: npx tsx scripts/backfill-fifo-missed-conditions.ts
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
  request_timeout: 600000, // 10 minutes
});

const BATCH_SIZE = 100; // conditions per batch (same as cron)

async function query<T>(sql: string): Promise<T[]> {
  const result = await client.query({
    query: sql,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  return result.json();
}

async function execute(sql: string): Promise<void> {
  await client.command({
    query: sql,
    clickhouse_settings: { max_execution_time: 600 },
  });
}

async function getMissedConditions(): Promise<string[]> {
  console.log('Finding resolved conditions not yet in FIFO...');

  const result = await query<{ condition_id: string }>(`
    SELECT DISTINCT r.condition_id
    FROM pm_condition_resolutions r
    INNER JOIN pm_canonical_fills_v4 f ON r.condition_id = f.condition_id
    WHERE r.is_deleted = 0
      AND r.payout_numerators != ''
      AND f.source = 'clob'
      AND r.condition_id NOT IN (
        SELECT DISTINCT condition_id
        FROM pm_trade_fifo_roi_v3
      )
  `);

  return result.map((r) => r.condition_id);
}

async function processLongPositions(conditionIds: string[]): Promise<void> {
  if (conditionIds.length === 0) return;
  const conditionList = conditionIds.map((id) => `'${id}'`).join(',');

  await execute(`
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
      tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
      exit_value - cost_usd as pnl_usd,
      CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
      CASE WHEN (total_tokens_sold + tokens_held) > 0 THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100 ELSE 0 END as pct_sold_early,
      is_maker_flag as is_maker, resolved_at, 0 as is_short,
      CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END as is_closed
    FROM (
      SELECT buy.*,
        coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
        CASE
          WHEN buy.payout_numerators = '[1,1]' THEN 0.5
          WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
          WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END as payout_rate,
        least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))) as tokens_sold_early,
        buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0))) as tokens_held,
        (CASE WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
          (least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) / coalesce(sells.total_tokens_sold, 0)) * coalesce(sells.total_sell_proceeds, 0)
        ELSE 0 END) +
        ((buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
          PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)))) * CASE
          WHEN buy.payout_numerators = '[1,1]' THEN 0.5
          WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
          WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
          ELSE 0.0
        END) as exit_value
      FROM (
        SELECT _tx_hash as tx_hash, any(_order_id) as order_id, _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
          min(_event_time) as entry_time, sum(_tokens_delta) as tokens, sum(abs(_usdc_delta)) as cost_usd,
          max(_is_maker) as is_maker_flag, any(_payout_numerators) as payout_numerators, any(_resolved_at) as resolved_at
        FROM (
          SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time, any(wallet) as _wallet,
            any(condition_id) as _condition_id, any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta, any(is_maker) as _is_maker, any(is_self_fill) as _is_self_fill,
            any(source) as _source, any(r.payout_numerators) as _payout_numerators, any(r.resolved_at) as _resolved_at,
            splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
          FROM pm_canonical_fills_v4 f
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != ''
          GROUP BY fill_id
        )
        WHERE _source = 'clob' AND _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (_is_self_fill = 1 AND _is_maker = 1)
        GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
        HAVING cost_usd >= 0.01
      ) AS buy
      LEFT JOIN (
        SELECT _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
          sum(abs(_tokens_delta)) as total_tokens_sold, sum(abs(_usdc_delta)) as total_sell_proceeds
        FROM (
          SELECT fill_id, any(event_time) as _event_time, any(wallet) as _wallet, any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
            any(source) as _source, any(r.resolved_at) as _resolved_at
          FROM pm_canonical_fills_v4 f
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != ''
          GROUP BY fill_id
        )
        WHERE _source = 'clob' AND _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
          AND _event_time < _resolved_at
        GROUP BY _wallet, _condition_id, _outcome_index
      ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
    )
  `);
}

async function processShortPositions(conditionIds: string[]): Promise<void> {
  if (conditionIds.length === 0) return;
  const conditionList = conditionIds.map((id) => `'${id}'`).join(',');

  await execute(`
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
      any_order_id as order_id,
      wallet, condition_id, outcome_index, entry_time,
      abs(net_tokens) as tokens, -cash_flow as cost_usd, 0 as tokens_sold_early, abs(net_tokens) as tokens_held,
      CASE
        WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
        WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
        WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
        ELSE 0.0
      END as exit_value,
      cash_flow + CASE
        WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
        WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
        WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
        ELSE 0.0
      END as pnl_usd,
      CASE WHEN cash_flow > 0 THEN
        (cash_flow + CASE
          WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
          WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
          WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
          ELSE 0.0
        END) / cash_flow
      ELSE 0 END as roi,
      0 as pct_sold_early, 0 as is_maker, resolved_at, 1 as is_short,
      CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END as is_closed
    FROM (
      SELECT wallet, condition_id, outcome_index, min(event_time) as entry_time,
        sum(tokens_delta) as net_tokens, sum(usdc_delta) as cash_flow,
        any(_payout_numerators) as payout_numerators, any(_resolved_at) as resolved_at,
        any(_order_id) as any_order_id
      FROM (
        SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet, any(condition_id) as condition_id,
          any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
          any(source) as source, any(is_self_fill) as is_self_fill, any(is_maker) as is_maker,
          any(r.payout_numerators) as _payout_numerators, any(r.resolved_at) as _resolved_at,
          splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
        FROM pm_canonical_fills_v4 f
        INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        WHERE f.condition_id IN (${conditionList}) AND r.is_deleted = 0 AND r.payout_numerators != ''
        GROUP BY fill_id
      )
      WHERE source = 'clob' AND wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (is_self_fill = 1 AND is_maker = 1)
      GROUP BY wallet, condition_id, outcome_index
      HAVING net_tokens < -0.01 AND cash_flow > 0.01
    )
  `);
}

async function main() {
  console.log('=== FIFO Missed Conditions Backfill ===\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Get initial state
  const initialCount = await query<{ cnt: number }>(
    'SELECT count() as cnt FROM pm_trade_fifo_roi_v3'
  );
  console.log(`Initial FIFO rows: ${initialCount[0].cnt.toLocaleString()}\n`);

  // Find all missed conditions
  const conditions = await getMissedConditions();
  console.log(`Found ${conditions.length.toLocaleString()} missed conditions to backfill\n`);

  if (conditions.length === 0) {
    console.log('All resolved conditions are already in FIFO. Nothing to do.');
    await client.close();
    return;
  }

  // Process in batches
  let totalBatches = Math.ceil(conditions.length / BATCH_SIZE);
  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = processed > 0 ? (processed / ((Date.now() - startTime) / 1000)).toFixed(1) : '0';

    console.log(
      `Batch ${batchNum}/${totalBatches} (${batch.length} conditions) | ` +
        `${processed}/${conditions.length} done | ${elapsed}s elapsed | ${rate} cond/s`
    );

    try {
      await processLongPositions(batch);
      await processShortPositions(batch);
      processed += batch.length;
    } catch (err: any) {
      errors++;
      console.error(`  ERROR in batch ${batchNum}: ${err.message}`);
      // Continue with next batch
    }
  }

  // Get final state
  const finalCount = await query<{ cnt: number }>(
    'SELECT count() as cnt FROM pm_trade_fifo_roi_v3'
  );
  const newRows = finalCount[0].cnt - initialCount[0].cnt;
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== Backfill Complete ===');
  console.log(`Conditions processed: ${processed.toLocaleString()}`);
  console.log(`Errors: ${errors}`);
  console.log(`New FIFO rows: ${newRows.toLocaleString()}`);
  console.log(`Final FIFO rows: ${finalCount[0].cnt.toLocaleString()}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Completed at: ${new Date().toISOString()}`);

  await client.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
