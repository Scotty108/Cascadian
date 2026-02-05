#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - TRUE FIFO for Closed Positions (Unresolved Markets)
 *
 * Populates unresolved+closed positions in pm_trade_fifo_roi_v3
 * These are positions where the trader fully exited before market resolution.
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

const BATCH_SIZE = 50;

async function getUnresolvedClosedConditions(): Promise<string[]> {
  console.log('Finding unresolved markets with closed positions...\n');

  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM (
        SELECT
          condition_id,
          wallet,
          outcome_index,
          sum(tokens_delta) as net_tokens
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND condition_id NOT IN (
            SELECT condition_id FROM pm_condition_resolutions
            WHERE is_deleted = 0 AND payout_numerators != ''
          )
        GROUP BY condition_id, wallet, outcome_index
        HAVING abs(net_tokens) < 0.01  -- Closed position
      )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });

  const rows = await result.json() as { condition_id: string }[];
  console.log(`Found ${rows.length} unresolved markets with closed positions\n`);
  return rows.map(r => r.condition_id);
}

async function processConditionBatch(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // TRUE FIFO logic for closed positions in unresolved markets
  const query = `
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
      tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
      exit_value - cost_usd as pnl_usd,
      CASE WHEN cost_usd > 0.01 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
      CASE WHEN (total_tokens_sold + tokens_held) > 0.01
        THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100
        ELSE 0
      END as pct_sold_early,
      is_maker_flag as is_maker,
      last_trade_time as resolved_at,  -- Use last trade time as pseudo-resolution
      0 as is_short,
      1 as is_closed
    FROM (
      SELECT
        buy.*,
        coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
        coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
        coalesce(sells.last_trade_time, buy.entry_time) as last_trade_time,

        -- FIFO Token Allocation
        least(
          buy.tokens,
          greatest(0,
            coalesce(sells.total_tokens_sold, 0) -
            coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
              ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0)
          )
        ) as tokens_sold_early,

        buy.tokens - least(
          buy.tokens,
          greatest(0,
            coalesce(sells.total_tokens_sold, 0) -
            coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
              ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0)
          )
        ) as tokens_held,

        -- Exit value: proportional share of sell proceeds
        CASE WHEN coalesce(sells.total_tokens_sold, 0) > 0.01 THEN
          (least(
            buy.tokens,
            greatest(0,
              coalesce(sells.total_tokens_sold, 0) -
              coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0)
            )
          ) / sells.total_tokens_sold) * sells.total_sell_proceeds
        ELSE 0 END as exit_value

      FROM (
        -- Aggregate buys by transaction
        SELECT
          _tx_hash as tx_hash,
          any(_order_id) as order_id,
          _wallet as wallet,
          _condition_id as condition_id,
          _outcome_index as outcome_index,
          min(_event_time) as entry_time,
          sum(_tokens_delta) as tokens,
          sum(abs(_usdc_delta)) as cost_usd,
          max(_is_maker) as is_maker_flag
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
          WHERE condition_id IN (${conditionList})
            AND source = 'clob'
          GROUP BY fill_id
        )
        WHERE _tokens_delta > 0
          AND _wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (_is_self_fill = 1 AND _is_maker = 1)
        GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
        HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
      ) AS buy

      LEFT JOIN (
        -- Aggregate sells per position
        SELECT
          _wallet as wallet,
          _condition_id as condition_id,
          _outcome_index as outcome_index,
          sum(abs(_tokens_delta)) as total_tokens_sold,
          sum(_usdc_delta) as total_sell_proceeds,
          max(_event_time) as last_trade_time
        FROM (
          SELECT
            fill_id,
            any(wallet) as _wallet,
            any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index,
            any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta,
            any(event_time) as _event_time
          FROM pm_canonical_fills_v4
          WHERE condition_id IN (${conditionList})
            AND source = 'clob'
          GROUP BY fill_id
        )
        WHERE _tokens_delta < 0
          AND _wallet != '0x0000000000000000000000000000000000000000'
        GROUP BY _wallet, _condition_id, _outcome_index
      ) AS sells
        ON buy.wallet = sells.wallet
        AND buy.condition_id = sells.condition_id
        AND buy.outcome_index = sells.outcome_index
    )
    -- Only insert CLOSED positions (tokens_held ≈ 0)
    WHERE tokens_held < 0.01
  `;

  await client.command({
    query,
    clickhouse_settings: {
      max_execution_time: 300,
      max_memory_usage: 8000000000,
    },
  });

  return conditionIds.length;
}

async function main() {
  console.log('🔨 Building FIFO V5 (Closed Positions in Unresolved Markets)\n');

  const startTime = Date.now();

  // Check current state
  const beforeRes = await client.query({
    query: `SELECT count() as cnt, countIf(is_closed = 1) as closed FROM pm_trade_fifo_roi_v3`,
    format: 'JSONEachRow',
  });
  const before = (await beforeRes.json() as any[])[0];
  console.log(`Before: ${parseInt(before.cnt).toLocaleString()} rows, ${parseInt(before.closed).toLocaleString()} closed\n`);

  // Get conditions to process
  const conditionIds = await getUnresolvedClosedConditions();

  if (conditionIds.length === 0) {
    console.log('No closed positions found. Exiting.\n');
    await client.close();
    return;
  }

  let totalProcessed = 0;
  const totalBatches = Math.ceil(conditionIds.length / BATCH_SIZE);

  console.log(`Processing ${conditionIds.length} conditions in ${totalBatches} batches...\n`);

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = conditionIds.slice(i, i + BATCH_SIZE);

    if (batchNum % 10 === 1 || batchNum === totalBatches) {
      console.log(`Batch ${batchNum}/${totalBatches}...`);
    }

    try {
      await processConditionBatch(batch);
      totalProcessed += batch.length;
    } catch (error: any) {
      console.error(`  Error batch ${batchNum}: ${error.message.substring(0, 80)}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Check after state
  const afterRes = await client.query({
    query: `SELECT count() as cnt, countIf(is_closed = 1) as closed FROM pm_trade_fifo_roi_v3`,
    format: 'JSONEachRow',
  });
  const after = (await afterRes.json() as any[])[0];

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Closed Positions Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Conditions processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Duration: ${duration} minutes`);
  console.log(`\nAfter: ${parseInt(after.cnt).toLocaleString()} rows, ${parseInt(after.closed).toLocaleString()} closed`);
  console.log(`Added: ${(after.cnt - before.cnt).toLocaleString()} rows`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
