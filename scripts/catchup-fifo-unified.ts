#!/usr/bin/env npx tsx
/**
 * Catch-up script for FIFO and Unified tables
 *
 * Processes all pending resolutions and syncs to unified table.
 * Run: npx tsx scripts/catchup-fifo-unified.ts
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const host = process.env.CLICKHOUSE_HOST || '';
const url = host.startsWith('http') ? host : `https://${host}:8443`;

const client = createClient({
  url,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    max_execution_time: 600,
  },
});

const BATCH_SIZE = 50;

async function getStats() {
  const result = await client.query({
    query: `
      SELECT
        'v3' as table_name,
        count() as total,
        countIf(is_short = 0 AND resolved_at IS NOT NULL) as resolved_longs,
        countIf(is_short = 0 AND resolved_at IS NULL) as unresolved_longs,
        max(entry_time) as newest_entry
      FROM pm_trade_fifo_roi_v3

      UNION ALL

      SELECT
        'unified',
        count(),
        countIf(is_short = 0 AND resolved_at IS NOT NULL),
        countIf(is_short = 0 AND resolved_at IS NULL),
        max(entry_time)
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  return await result.json();
}

async function getPendingConditions(): Promise<string[]> {
  // Get conditions with fills that aren't in FIFO table yet
  const result = await client.query({
    query: `
      SELECT DISTINCT r.condition_id
      FROM pm_condition_resolutions r
      INNER JOIN pm_canonical_fills_v4 f ON r.condition_id = f.condition_id
      WHERE r.is_deleted = 0
        AND r.payout_numerators != ''
        AND f.source = 'clob'
        AND r.condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
        )
      LIMIT 5000
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const rows = (await result.json()) as { condition_id: string }[];
  return rows.map(r => r.condition_id);
}

async function processLongPositions(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  const query = `
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
            -- Extract order_id from fill_id: clob_{tx_hash}_{order_id}-{m/t}
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
  `;

  await client.command({ query, clickhouse_settings: { max_execution_time: 300 } });
  return conditionIds.length;
}

async function processShortPositions(conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map(id => `'${id}'`).join(',');

  const query = `
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
  `;

  await client.command({ query, clickhouse_settings: { max_execution_time: 300 } });
  return conditionIds.length;
}

async function syncToUnified(): Promise<number> {
  // Sync resolved LONGs from v3 to unified (with anti-join to avoid duplicates)
  const result = await client.query({
    query: `
      SELECT count() as missing
      FROM pm_trade_fifo_roi_v3 v
      LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.is_short = 0
        AND v.resolved_at IS NOT NULL
        AND u.tx_hash IS NULL
    `,
    format: 'JSONEachRow',
  });
  const missing = ((await result.json()) as any)[0]?.missing || 0;

  if (missing === 0) {
    console.log('   No missing positions to sync');
    return 0;
  }

  console.log(`   Found ${missing.toLocaleString()} missing positions, syncing...`);

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
        v.pnl_usd, v.roi, v.pct_sold_early, v.is_maker,
        1 as is_closed, v.is_short
      FROM pm_trade_fifo_roi_v3 v
      LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
        ON v.tx_hash = u.tx_hash
        AND v.wallet = u.wallet
        AND v.condition_id = u.condition_id
        AND v.outcome_index = u.outcome_index
      WHERE v.is_short = 0
        AND v.resolved_at IS NOT NULL
        AND u.tx_hash IS NULL
    `,
    clickhouse_settings: { max_execution_time: 600 },
  });

  return missing;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Catch-up: FIFO + Unified Tables');
  console.log('='.repeat(60));

  const startTime = Date.now();

  // Initial stats
  console.log('\n📊 Initial Stats:');
  console.table(await getStats());

  // Step 1: Process pending conditions into v3
  console.log('\n🔄 Step 1: Processing pending resolutions into FIFO table...');
  const pendingConditions = await getPendingConditions();
  console.log(`   Found ${pendingConditions.length} conditions to process`);

  if (pendingConditions.length > 0) {
    let processed = 0;
    for (let i = 0; i < pendingConditions.length; i += BATCH_SIZE) {
      const batch = pendingConditions.slice(i, i + BATCH_SIZE);
      try {
        await processLongPositions(batch);
        await processShortPositions(batch);
        processed += batch.length;
        console.log(`   Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pendingConditions.length / BATCH_SIZE)} (${processed}/${pendingConditions.length})`);
      } catch (err: any) {
        console.error(`   Error in batch: ${err.message}`);
      }
    }
    console.log(`   Completed: ${processed} conditions processed`);
  }

  // Step 2: Sync to unified
  console.log('\n🔄 Step 2: Syncing resolved positions to unified table...');
  const synced = await syncToUnified();
  console.log(`   Synced ${synced.toLocaleString()} positions`);

  // Final stats
  console.log('\n📊 Final Stats:');
  console.table(await getStats());

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Completed in ${elapsed} minutes`);

  await client.close();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
