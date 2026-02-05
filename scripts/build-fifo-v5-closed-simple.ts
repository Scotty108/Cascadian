#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Closed Positions (Simple Aggregate Version)
 *
 * Populates unresolved+closed positions using simple aggregation (no window functions).
 * One row per (wallet, condition_id, outcome_index) for closed positions.
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

const BATCH_SIZE = 50; // Smaller batches for reliability

async function getUnresolvedConditions(): Promise<string[]> {
  console.log('Finding unresolved conditions...\n');

  const result = await client.query({
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
    clickhouse_settings: { max_execution_time: 120 },
  });

  const rows = await result.json() as { condition_id: string }[];
  console.log(`Found ${rows.length} unresolved conditions\n`);
  return rows.map(r => r.condition_id);
}

async function processConditionBatch(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  // Simple aggregate approach - one row per closed position
  const query = `
    INSERT INTO pm_trade_fifo_roi_v3
    SELECT
      concat('closed_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
      '' as order_id,
      wallet,
      condition_id,
      outcome_index,
      first_trade as entry_time,
      0 as tokens,
      total_buy_cost as cost_usd,
      total_tokens_bought as tokens_sold_early,
      0 as tokens_held,
      total_sell_proceeds as exit_value,
      total_sell_proceeds - total_buy_cost as pnl_usd,
      CASE
        WHEN total_buy_cost > 0.01 THEN (total_sell_proceeds - total_buy_cost) / total_buy_cost
        ELSE 0
      END as roi,
      100 as pct_sold_early,
      any_is_maker as is_maker,
      last_trade as resolved_at,
      0 as is_short,
      1 as is_closed
    FROM (
      SELECT
        _wallet as wallet,
        _condition_id as condition_id,
        _outcome_index as outcome_index,
        sum(_tokens_delta) as net_tokens,
        sumIf(_tokens_delta, _tokens_delta > 0) as total_tokens_bought,
        abs(sumIf(_tokens_delta, _tokens_delta < 0)) as total_tokens_sold,
        sumIf(abs(_usdc_delta), _usdc_delta < 0) as total_buy_cost,
        sumIf(_usdc_delta, _usdc_delta > 0) as total_sell_proceeds,
        min(_event_time) as first_trade,
        max(_event_time) as last_trade,
        max(_is_maker) as any_is_maker
      FROM (
        SELECT
          fill_id,
          any(wallet) as _wallet,
          any(condition_id) as _condition_id,
          any(outcome_index) as _outcome_index,
          any(tokens_delta) as _tokens_delta,
          any(usdc_delta) as _usdc_delta,
          any(event_time) as _event_time,
          any(is_maker) as _is_maker,
          any(is_self_fill) as _is_self_fill
        FROM pm_canonical_fills_v4
        WHERE condition_id IN (${conditionList})
          AND source = 'clob'
        GROUP BY fill_id
      )
      WHERE _wallet != '0x0000000000000000000000000000000000000000'
        AND NOT (_is_self_fill = 1 AND _is_maker = 1)
      GROUP BY _wallet, _condition_id, _outcome_index
      HAVING abs(net_tokens) < 0.01  -- Closed (net zero tokens)
        AND total_tokens_bought > 0.01  -- Must have bought
        AND total_tokens_sold > 0.01  -- Must have sold
        AND total_buy_cost > 0.01  -- Non-dust
    )
  `;

  await client.command({
    query,
    clickhouse_settings: { max_execution_time: 120 },
  });

  return conditionIds.length;
}

async function main() {
  console.log('🔨 Building FIFO V5 - Closed Positions (Simple Aggregate)\n');

  const startTime = Date.now();

  // Check current state
  const beforeRes = await client.query({
    query: `SELECT count() as cnt, countIf(is_closed = 1 AND resolved_at < '2026-01-01') as closed_unresolved FROM pm_trade_fifo_roi_v3`,
    format: 'JSONEachRow',
  });
  const before = (await beforeRes.json() as any[])[0];
  console.log(`Before: ${parseInt(before.cnt).toLocaleString()} rows\n`);

  // Get conditions
  const conditionIds = await getUnresolvedConditions();

  if (conditionIds.length === 0) {
    console.log('No unresolved conditions. Exiting.\n');
    await client.close();
    return;
  }

  let totalProcessed = 0;
  const totalBatches = Math.ceil(conditionIds.length / BATCH_SIZE);

  console.log(`Processing ${conditionIds.length} conditions in ${totalBatches} batches...\n`);

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = conditionIds.slice(i, i + BATCH_SIZE);

    process.stdout.write(`Batch ${batchNum}/${totalBatches}... `);

    try {
      await processConditionBatch(batch);
      totalProcessed += batch.length;
      console.log('✓');
    } catch (error: any) {
      console.log(`✗ ${error.message.substring(0, 60)}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Check after state
  const afterRes = await client.query({
    query: `
      SELECT
        count() as cnt,
        countIf(is_closed = 1) as closed,
        countIf(is_closed = 1 AND tx_hash LIKE 'closed_%') as closed_unresolved
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const after = (await afterRes.json() as any[])[0];

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Closed Positions Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Conditions processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Duration: ${duration} minutes`);
  console.log(`\nAfter: ${parseInt(after.cnt).toLocaleString()} rows`);
  console.log(`  Closed (total): ${parseInt(after.closed).toLocaleString()}`);
  console.log(`  Closed (unresolved): ${parseInt(after.closed_unresolved).toLocaleString()}`);
  console.log(`Added: ${(after.cnt - before.cnt).toLocaleString()} rows`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
