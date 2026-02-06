/**
 * Backfill FIFO V5 sell tracking for all unresolved LONG positions in unified table.
 *
 * Problem: All 16.8M unresolved LONG positions have hardcoded zeros for sell data.
 * Strategy: Single-pass approach using temp table for condition filter.
 * Scans canonical fills only TWICE (buys + sells) instead of 252 times.
 *
 * ReplacingMergeTree deduplicates stale zero-sell rows on background merge.
 * Use FINAL in queries for accurate reads before merge completes.
 *
 * Usage: npx tsx scripts/backfill-unresolved-fifo-v5.ts
 * Estimated runtime: 10-20 minutes
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const QUERY_SETTINGS = {
  max_execution_time: 600,
  max_memory_usage: 10_000_000_000,
  join_use_nulls: 1,
} as Record<string, any>;

async function main() {
  console.log('=== Backfill FIFO V5 sell tracking for unresolved LONG positions ===');
  console.log('Strategy: Single-pass via temp table (2 scans instead of 252)\n');

  // Before stats
  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at <= '1970-01-01 00:00:00') as unresolved,
        countIf(resolved_at > '1970-01-01') as resolved,
        countIf(resolved_at <= '1970-01-01' AND is_short = 0 AND tokens_sold_early > 0) as unresolved_with_sells,
        countIf(resolved_at <= '1970-01-01' AND is_short = 0 AND is_closed = 1) as unresolved_closed
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
    clickhouse_settings: QUERY_SETTINGS,
  });
  const before = (await beforeResult.json() as any[])[0];
  console.log(`BEFORE: total=${Number(before.total).toLocaleString()}, resolved=${Number(before.resolved).toLocaleString()}, unresolved=${Number(before.unresolved).toLocaleString()}`);
  console.log(`        with_sells=${Number(before.unresolved_with_sells).toLocaleString()}, closed=${Number(before.unresolved_closed).toLocaleString()}\n`);

  // Step 1: Create temp table with unresolved condition IDs
  console.log('Step 1: Creating temp table with unresolved condition IDs...');
  const tempTable = `temp_backfill_fifo_v5_${Date.now()}`;

  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${tempTable}` });
  await clickhouse.command({
    query: `CREATE TABLE ${tempTable} (condition_id String) ENGINE = Memory`,
  });
  await clickhouse.command({
    query: `
      INSERT INTO ${tempTable}
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at <= '1970-01-01 00:00:00'
        AND is_short = 0
    `,
    clickhouse_settings: QUERY_SETTINGS,
  });

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${tempTable}`,
    format: 'JSONEachRow',
  });
  const conditionCount = ((await countResult.json()) as any[])[0].cnt;
  console.log(`  Found ${Number(conditionCount).toLocaleString()} unresolved conditions\n`);

  // Step 2: Single INSERT with FIFO V5 — joins against temp table instead of IN list
  console.log('Step 2: Running single-pass FIFO V5 INSERT (this is the big one)...');
  const insertStart = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
         resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
         exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
      SELECT
        fifo.tx_hash, fifo.order_id, fifo.wallet, fifo.condition_id, fifo.outcome_index,
        fifo.entry_time, toDateTime('1970-01-01 00:00:00') as resolved_at,
        fifo.tokens, fifo.cost_usd, fifo.tokens_sold_early, fifo.tokens_held,
        fifo.exit_value,
        fifo.exit_value - fifo.cost_usd as pnl_usd,
        CASE WHEN fifo.cost_usd > 0.01 THEN (fifo.exit_value - fifo.cost_usd) / fifo.cost_usd ELSE 0 END as roi,
        CASE WHEN (fifo.tokens_sold_early + fifo.tokens_held) > 0.01
          THEN fifo.tokens_sold_early / (fifo.tokens_sold_early + fifo.tokens_held) * 100
          ELSE 0
        END as pct_sold_early,
        fifo.is_maker_flag as is_maker,
        CASE WHEN fifo.tokens_held < 0.01 THEN 1 ELSE 0 END as is_closed,
        0 as is_short
      FROM (
        SELECT
          buy.*,
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
            WHERE condition_id IN (SELECT condition_id FROM ${tempTable})
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING sum(abs(_usdc_delta)) >= 0.01 AND sum(_tokens_delta) >= 0.01
        ) AS buy
        LEFT JOIN (
          SELECT _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
            sum(abs(_tokens_delta)) as total_tokens_sold, sum(_usdc_delta) as total_sell_proceeds
          FROM (
            SELECT fill_id, any(wallet) as _wallet, any(condition_id) as _condition_id,
              any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
              any(usdc_delta) as _usdc_delta
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (SELECT condition_id FROM ${tempTable})
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
          GROUP BY _wallet, _condition_id, _outcome_index
        ) AS sells
          ON buy.wallet = sells.wallet
          AND buy.condition_id = sells.condition_id
          AND buy.outcome_index = sells.outcome_index
      ) AS fifo
    `,
    clickhouse_settings: QUERY_SETTINGS,
  });

  const insertDuration = ((Date.now() - insertStart) / 1000).toFixed(0);
  console.log(`  INSERT completed in ${insertDuration}s\n`);

  // Step 3: Cleanup
  console.log('Step 3: Cleaning up temp table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${tempTable}` });

  // Wait for async inserts to flush
  console.log('Waiting 10s for inserts to flush...');
  await new Promise(r => setTimeout(r, 10000));

  // After stats
  const afterResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at <= '1970-01-01 00:00:00') as unresolved,
        countIf(resolved_at > '1970-01-01') as resolved,
        countIf(resolved_at <= '1970-01-01' AND is_short = 0 AND tokens_sold_early > 0) as unresolved_with_sells,
        countIf(resolved_at <= '1970-01-01' AND is_short = 0 AND is_closed = 1) as unresolved_closed
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
    clickhouse_settings: QUERY_SETTINGS,
  });
  const after = (await afterResult.json() as any[])[0];

  console.log('\n=== RESULTS ===');
  console.log(`BEFORE: total=${Number(before.total).toLocaleString()}, unresolved=${Number(before.unresolved).toLocaleString()}, with_sells=${Number(before.unresolved_with_sells).toLocaleString()}, closed=${Number(before.unresolved_closed).toLocaleString()}`);
  console.log(`AFTER:  total=${Number(after.total).toLocaleString()}, unresolved=${Number(after.unresolved).toLocaleString()}, with_sells=${Number(after.unresolved_with_sells).toLocaleString()}, closed=${Number(after.unresolved_closed).toLocaleString()}`);
  console.log(`ROW DELTA: ${(Number(after.total) - Number(before.total)).toLocaleString()} (dupes until merge)`);
  console.log(`NEW SELLS TRACKED: ${(Number(after.unresolved_with_sells) - Number(before.unresolved_with_sells)).toLocaleString()}`);
  console.log(`NEW CLOSED: ${(Number(after.unresolved_closed) - Number(before.unresolved_closed)).toLocaleString()}`);
  console.log(`\nNote: Use FINAL in queries for accurate reads until background merge completes.`);
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
