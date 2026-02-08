/**
 * Cron: Refresh Unified FIFO Table (ALL-IN-ONE)
 *
 * This single cron updates EVERYTHING in pm_trade_fifo_roi_v3_mat_unified:
 * 1. Process new resolutions → FIFO calculations (resolved PnL)
 * 2. Sync resolved positions to unified table
 * 3. Refresh ALL unresolved positions (LONG + SHORT)
 *
 * Schedule: Every 2 hours at :45
 * Timeout: 10 minutes (Vercel Pro limit)
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 *
 * Error Isolation: Each step runs in its own try/catch. Non-critical steps
 * can fail without affecting overall success. Only fails the cron if ALL
 * critical steps fail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const maxDuration = 600; // 10 minutes (Vercel Pro limit: 800s)
export const dynamic = 'force-dynamic';
export const revalidate = 0; // Force no caching

const LOOKBACK_HOURS = 4; // 4 hours lookback (cron runs every 2h, 2x safety margin)
const BATCH_SIZE = 200; // Conditions per batch for unresolved processing
const FIFO_BATCH_SIZE = 25; // Conditions per FIFO batch
const MAX_FIFO_CONDITIONS = 100; // Process up to 4 FIFO batches per run (was 25, caused 89h backlog)
const MAX_RUNTIME_MS = 540000; // 9 minutes - leave 1 min buffer for logging/response

// Critical steps: overall cron fails only if ALL of these fail
const CRITICAL_STEPS = new Set([
  'processPendingResolutions',
  'processUnresolvedBatch',
  'updateResolvedPositions',
  'syncNewResolvedPositions',
]);

interface StepResult {
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  result?: any;
  error?: string;
}

/**
 * Run a single step with error isolation. Returns a StepResult
 * instead of propagating exceptions.
 */
async function runStep<T>(
  stepName: string,
  fn: () => Promise<T>,
): Promise<StepResult> {
  const stepStart = Date.now();
  try {
    const result = await fn();
    const duration_ms = Date.now() - stepStart;
    console.log(`[Cron] Step ${stepName} completed in ${(duration_ms / 1000).toFixed(1)}s`);
    return { status: 'success', duration_ms, result };
  } catch (error: any) {
    const duration_ms = Date.now() - stepStart;
    const errorMessage = error.message || String(error);
    const isCritical = CRITICAL_STEPS.has(stepName);
    console.error(
      `[Cron] Step ${stepName} FAILED (${isCritical ? 'CRITICAL' : 'non-critical'}) after ${(duration_ms / 1000).toFixed(1)}s:`,
      errorMessage,
    );
    return { status: 'failed', duration_ms, error: errorMessage };
  }
}

/**
 * Step 0: Process new resolutions into pm_trade_fifo_roi_v3
 * This calculates FIFO PnL for recently resolved markets
 */
async function processPendingResolutions(client: any): Promise<number> {
  // Find conditions resolved in last 7 days that aren't yet in FIFO table
  // IMPORTANT: Filter by conditions that actually have CLOB fills to avoid
  // processing ~23K empty conditions (CTF-only, NegRisk-only) every run
  const result = await client.query({
    query: `
      SELECT condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND resolved_at >= now() - INTERVAL 168 HOUR
        AND condition_id IN (
          SELECT DISTINCT condition_id FROM pm_canonical_fills_v4 WHERE source = 'clob'
        )
        AND condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
        )
      LIMIT ${MAX_FIFO_CONDITIONS}
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  const conditions = (await result.json() as { condition_id: string }[]).map(r => r.condition_id);

  if (conditions.length === 0) {
    return 0;
  }

  // Process in batches
  for (let i = 0; i < conditions.length; i += FIFO_BATCH_SIZE) {
    const batch = conditions.slice(i, i + FIFO_BATCH_SIZE);
    const conditionList = batch.map(id => `'${id}'`).join(',');

    // Insert FIFO calculated positions for these conditions
    // IMPORTANT: Column order MUST match table schema (18 columns):
    // tx_hash, order_id, wallet, condition_id, outcome_index, entry_time, tokens, cost_usd,
    // tokens_sold_early, tokens_held, exit_value, pnl_usd, roi, pct_sold_early,
    // is_maker, resolved_at, is_short, is_closed
    await client.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3
          (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
           tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
           pnl_usd, roi, pct_sold_early, is_maker, resolved_at, is_short, is_closed)
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
              -- Extract order_id from fill_id: clob_{tx_hash}_{order_id}-{m/t}
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
      clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
    });
  }

  return conditions.length;
}

async function getActiveConditions(client: any): Promise<string[]> {
  // Find unresolved conditions with recent activity that are NOT already in unified
  // Only process conditions missing from unified to avoid recomputing existing positions
  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
        AND condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3_mat_unified
        )
      LIMIT 500
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  return ((await result.json()) as { condition_id: string }[]).map(r => r.condition_id);
}

async function processUnresolvedConditions(
  client: any,
  conditions: string[],
): Promise<number> {
  const conditionList = conditions.map(id => `'${id}'`).join(',');

  // Process LONG positions with FIFO V5 sell tracking (with anti-join to prevent duplicates)
  const longQuery = `
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
       resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
       exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
    SELECT
      fifo.tx_hash, fifo.order_id, fifo.wallet, fifo.condition_id, fifo.outcome_index,
      fifo.entry_time,
      toDateTime('1970-01-01 00:00:00') as resolved_at,
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
        -- FIFO V5: allocate sells to earliest buys first using window function
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
      ) AS buy
      LEFT JOIN (
        SELECT _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
          sum(abs(_tokens_delta)) as total_tokens_sold, sum(_usdc_delta) as total_sell_proceeds
        FROM (
          SELECT fill_id, any(wallet) as _wallet, any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta
          FROM pm_canonical_fills_v4
          WHERE condition_id IN (${conditionList}) AND source = 'clob'
          GROUP BY fill_id
        )
        WHERE _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
        GROUP BY _wallet, _condition_id, _outcome_index
      ) AS sells
        ON buy.wallet = sells.wallet
        AND buy.condition_id = sells.condition_id
        AND buy.outcome_index = sells.outcome_index
    ) AS fifo
    WHERE (fifo.tx_hash, fifo.wallet, fifo.condition_id, fifo.outcome_index) NOT IN (
      SELECT tx_hash, wallet, condition_id, outcome_index
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE condition_id IN (${conditionList})
    )
  `;

  await client.command({
    query: longQuery,
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  // Process SHORT positions (with anti-join to prevent duplicates)
  const shortQuery = `
    INSERT INTO pm_trade_fifo_roi_v3_mat_unified
      (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
       resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
       exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
    SELECT
      new.tx_hash,
      new.order_id,
      new.wallet,
      new.condition_id,
      new.outcome_index,
      new.entry_time,
      toDateTime('1970-01-01 00:00:00') as resolved_at,
      new.tokens,
      new.cost_usd,
      0 as tokens_sold_early,
      new.tokens as tokens_held,
      0 as exit_value,
      0 as pnl_usd,
      0 as roi,
      0 as pct_sold_early,
      0 as is_maker,
      0 as is_closed,
      1 as is_short
    FROM (
      SELECT
        concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index), '_', toString(toUnixTimestamp(entry_time))) as tx_hash,
        any_order_id as order_id,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        abs(net_tokens) as tokens,
        abs(cash_flow) as cost_usd
      FROM (
        SELECT
          fills._wallet as wallet,
          fills._condition_id as condition_id,
          fills._outcome_index as outcome_index,
          min(fills._event_time) as entry_time,
          sum(fills._tokens_delta) as net_tokens,
          sum(fills._usdc_delta) as cash_flow,
          any(fills._order_id) as any_order_id
        FROM (
          SELECT
            fill_id,
            any(event_time) as _event_time,
            any(wallet) as _wallet,
            any(condition_id) as _condition_id,
            any(outcome_index) as _outcome_index,
            any(tokens_delta) as _tokens_delta,
            any(usdc_delta) as _usdc_delta,
            any(source) as _source,
            any(is_self_fill) as _is_self_fill,
            any(is_maker) as _is_maker,
            splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
          FROM pm_canonical_fills_v4
          WHERE condition_id IN (${conditionList})
            AND source = 'clob'
          GROUP BY fill_id
        ) AS fills
        WHERE fills._source = 'clob'
          AND fills._wallet != '0x0000000000000000000000000000000000000000'
          AND NOT (fills._is_self_fill = 1 AND fills._is_maker = 1)
        GROUP BY fills._wallet, fills._condition_id, fills._outcome_index
        HAVING net_tokens < -0.01
          AND cash_flow > 0.01
      )
    ) AS new
    WHERE (new.wallet, new.condition_id, new.outcome_index) NOT IN (
      SELECT wallet, condition_id, outcome_index
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE condition_id IN (${conditionList})
        AND is_short = 1
    )
  `;

  await client.command({
    query: shortQuery,
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  return conditions.length;
}

async function updateResolvedPositions(client: any, executionId: string): Promise<number> {
  const tempTable = `temp_resolved_keys_${executionId}`;
  // Find conditions that have unresolved rows in unified but are actually resolved
  // Avoids massive cross-table JOIN by querying unified directly (scoped to resolutions)
  const conditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at <= '1970-01-01 00:00:00'
        AND condition_id IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
      LIMIT 2000
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });
  const conditions = (await conditionsResult.json() as { condition_id: string }[]).map(r => r.condition_id);

  if (conditions.length === 0) {
    return 0;
  }

  const conditionList = conditions.map(id => `'${id}'`).join(',');

  // Step 2: Create temp table with keys to update (scoped to these conditions)
  await client.command({ query: `DROP TABLE IF EXISTS ${tempTable}` });

  await client.command({
    query: `
      CREATE TABLE ${tempTable} (
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8
      ) ENGINE = Memory
    `,
  });

  await client.command({
    query: `
      INSERT INTO ${tempTable}
      SELECT DISTINCT tx_hash, wallet, condition_id, outcome_index
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE condition_id IN (${conditionList})
        AND resolved_at <= '1970-01-01 00:00:00'
    `,
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  // Step 3: Delete old unresolved rows
  await client.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE (tx_hash, wallet, condition_id, outcome_index) IN (
        SELECT tx_hash, wallet, condition_id, outcome_index
        FROM ${tempTable}
      )
    `,
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  // Wait for DELETE mutation to complete before inserting
  // This prevents race condition that creates duplicates
  let mutationDone = false;
  let attempts = 0;
  while (!mutationDone && attempts < 15) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const mutationCheck = await client.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND is_done = 0
      `,
      format: 'JSONEachRow',
    });
    const pending = ((await mutationCheck.json()) as any)[0]?.pending || 0;
    mutationDone = pending === 0;
    attempts++;
  }

  // Step 4: Insert resolved rows from v3 FINAL (scoped to specific conditions)
  // IMPORTANT: Use explicit column names to prevent column order bugs
  // (v3 and unified have different column orders)
  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        (tx_hash, order_id, wallet, condition_id, outcome_index, entry_time,
         resolved_at, tokens, cost_usd, tokens_sold_early, tokens_held,
         exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short)
      SELECT
        v.tx_hash,
        v.order_id,
        v.wallet,
        v.condition_id,
        v.outcome_index,
        v.entry_time,
        v.resolved_at,
        v.tokens,
        v.cost_usd,
        v.tokens_sold_early,
        v.tokens_held,
        v.exit_value,
        v.pnl_usd,
        v.roi,
        v.pct_sold_early,
        v.is_maker,
        CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
        v.is_short
      FROM pm_trade_fifo_roi_v3 AS v FINAL
      WHERE v.condition_id IN (${conditionList})
        AND v.resolved_at > '1970-01-01'
        AND v.condition_id != ''
    `,
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  // Step 5: Cleanup temp table
  await client.command({
    query: `DROP TABLE IF EXISTS ${tempTable}`,
  });

  return conditions.length;
}

async function deduplicateTable(client: any): Promise<void> {
  // Skip OPTIMIZE FINAL - too expensive for 307M+ rows (causes OOM at 10.80 GiB limit)
  // ReplacingMergeTree handles deduplication naturally via background merges
  console.log('[Cron] Skipping OPTIMIZE FINAL (background merges handle dedup for ReplacingMergeTree)');
}

async function refreshAllUnresolvedConditions(client: any): Promise<number> {
  // Get unresolved conditions with RECENT activity (last 4 hours)
  // Uses NOT IN subquery (fast: resolutions table is small ~422K rows)
  // instead of scanning all 1.19B canonical fills for DISTINCT condition_id
  const conditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND event_time >= now() - INTERVAL 4 HOUR
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });
  const conditions = ((await conditionsResult.json()) as { condition_id: string }[]).map((r) => r.condition_id);

  if (conditions.length === 0) {
    return 0;
  }

  // Process in batches: delete stale unresolved LONG rows then reinsert with FIFO V5 sell tracking
  const UNRESOLVED_BATCH_SIZE = 200;
  for (let i = 0; i < conditions.length; i += UNRESOLVED_BATCH_SIZE) {
    const batch = conditions.slice(i, i + UNRESOLVED_BATCH_SIZE);
    const conditionList = batch.map((id) => `'${id}'`).join(',');

    // Step A: Delete existing unresolved LONG rows for this batch so sell data gets refreshed
    await client.command({
      query: `
        ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
        DELETE WHERE condition_id IN (${conditionList})
          AND resolved_at <= '1970-01-01 00:00:00'
          AND is_short = 0
      `,
      clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
    });

    // Step B: Wait for DELETE mutation to complete
    let mutationDone = false;
    let attempts = 0;
    while (!mutationDone && attempts < 15) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mutationCheck = await client.query({
        query: `
          SELECT count() as pending
          FROM system.mutations
          WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
            AND is_done = 0
        `,
        format: 'JSONEachRow',
      });
      const pending = ((await mutationCheck.json()) as any)[0]?.pending || 0;
      mutationDone = pending === 0;
      attempts++;
    }

    // Step C: Insert fresh FIFO V5 rows with sell tracking
    await client.command({
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
                any(wallet) as _wallet, any(condition_id) as _condition_id, any(outcome_index) as _outcome_index,
                any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
                any(is_maker) as _is_maker, any(is_self_fill) as _is_self_fill,
                splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as _order_id
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList}) AND source = 'clob'
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
              WHERE condition_id IN (${conditionList}) AND source = 'clob'
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
      clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
    });
  }

  return conditions.length;
}

async function syncNewResolvedPositions(client: any): Promise<number> {
  // Find recently resolved conditions and sync them from v3 to unified
  // Uses condition-based approach (avoids massive wallet-level LEFT JOIN against 307M rows)
  const recentConditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND resolved_at >= now() - INTERVAL 168 HOUR
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });
  const recentConditions = ((await recentConditionsResult.json()) as { condition_id: string }[]).map((r) => r.condition_id);

  if (recentConditions.length === 0) return 0;

  let synced = 0;
  const SYNC_BATCH_SIZE = 500;

  for (let i = 0; i < recentConditions.length; i += SYNC_BATCH_SIZE) {
    const batch = recentConditions.slice(i, i + SYNC_BATCH_SIZE);
    const conditionList = batch.map((id) => `'${id}'`).join(',');

    // Insert from v3 with condition-scoped anti-join (loads only matching conditions from unified)
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
          CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
          v.is_short
        FROM pm_trade_fifo_roi_v3 v
        WHERE v.condition_id IN (${conditionList})
          AND v.resolved_at > '1970-01-01'
          AND v.condition_id != ''
          AND (v.tx_hash, v.wallet, v.condition_id, v.outcome_index) NOT IN (
            SELECT tx_hash, wallet, condition_id, outcome_index
            FROM pm_trade_fifo_roi_v3_mat_unified
            WHERE condition_id IN (${conditionList})
          )
      `,
      clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
    });

    synced += batch.length;
  }

  return synced;
}

async function getTableStats(client: any) {
  const result = await client.query({
    query: `
      SELECT
        count() as total_rows,
        uniq(wallet) as unique_wallets,
        countIf(resolved_at <= '1970-01-01 00:00:00') as unresolved,
        countIf(resolved_at > '1970-01-01 00:00:00') as resolved,
        countIf(resolved_at > '1970-01-01' AND resolved_at < '2020-01-01') as epoch_timestamps,
        max(entry_time) as latest_entry,
        max(resolved_at) as latest_resolution
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });

  const stats = await result.json() as any;
  return stats[0];
}

/**
 * Validate that no epoch timestamps were created in the last sync
 * Returns count of suspicious rows (resolved_at < 1971 for recent entries)
 */
async function validateTimestamps(client: any): Promise<number> {
  const result = await client.query({
    query: `
      SELECT count() as suspicious_count
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at < '1971-01-01'
        AND resolved_at IS NOT NULL
        AND entry_time >= now() - INTERVAL 48 HOUR
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 },
  });
  const data = await result.json() as any;
  return data[0]?.suspicious_count || 0;
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronRequest(request, 'refresh-unified-incremental');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();
  // Generate unique execution ID to prevent temp table race conditions
  const executionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const steps: Record<string, StepResult> = {};
  const warnings: string[] = [];

  try {
    const client = getClickHouseClient();

    console.log(`[Cron] Starting ALL-IN-ONE unified table refresh (exec: ${executionId})`);

    // Step 0: Process pending resolutions into FIFO table first (CRITICAL)
    steps.processPendingResolutions = await runStep('processPendingResolutions', () =>
      processPendingResolutions(client),
    );

    // Step 1: Get active unresolved conditions (process by condition, not wallet - 6x faster)
    const conditionsStep = await runStep('getActiveConditions', () => getActiveConditions(client));
    steps.getActiveConditions = conditionsStep;

    const activeConditions: string[] = conditionsStep.status === 'success' ? conditionsStep.result : [];
    console.log(`[Cron] Found ${activeConditions.length} active unresolved conditions`);

    // Step 2: Process unresolved batches by condition (CRITICAL)
    if (activeConditions.length > 0) {
      let batchProcessed = 0;
      steps.processUnresolvedBatch = await runStep('processUnresolvedBatch', async () => {
        for (let i = 0; i < activeConditions.length; i += BATCH_SIZE) {
          // Check time budget before each batch
          if (Date.now() - startTime > MAX_RUNTIME_MS - 120000) {
            console.log(`[Cron] Time budget reached after ${batchProcessed} conditions, stopping unresolved processing`);
            break;
          }
          const batch = activeConditions.slice(i, Math.min(i + BATCH_SIZE, activeConditions.length));
          await processUnresolvedConditions(client, batch);
          batchProcessed += batch.length;
          console.log(`[Cron] Processed condition batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(activeConditions.length / BATCH_SIZE)}`);
        }
        return batchProcessed;
      });
    } else {
      steps.processUnresolvedBatch = { status: 'skipped', duration_ms: 0, result: 'No active conditions' };
    }

    // Step 3: Update resolved positions (CRITICAL)
    steps.updateResolvedPositions = await runStep('updateResolvedPositions', () =>
      updateResolvedPositions(client, executionId),
    );

    // Step 4: Sync resolved positions from v3 (CRITICAL)
    steps.syncNewResolvedPositions = await runStep('syncNewResolvedPositions', () =>
      syncNewResolvedPositions(client),
    );

    // Time budget check: skip non-critical steps if running long
    const elapsed = Date.now() - startTime;
    const timeRemaining = MAX_RUNTIME_MS - elapsed;
    if (timeRemaining < 120000) {
      console.log(`[Cron] Time budget low (${(timeRemaining / 1000).toFixed(0)}s remaining), skipping non-critical steps`);
      warnings.push(`Skipped non-critical steps due to time budget (${(elapsed / 1000).toFixed(0)}s elapsed)`);
      steps.refreshAllUnresolvedConditions = { status: 'skipped', duration_ms: 0, result: 'Time budget' };
      steps.deduplicateTable = { status: 'skipped', duration_ms: 0, result: 'Time budget' };
      steps.validateTimestamps = { status: 'skipped', duration_ms: 0, result: 'Time budget' };
    } else {
      // Step 5: Refresh ALL unresolved conditions with FIFO V5 sell tracking (NON-CRITICAL)
      steps.refreshAllUnresolvedConditions = await runStep('refreshAllUnresolvedConditions', () =>
        refreshAllUnresolvedConditions(client),
      );

      // Step 6: Deduplicate (NON-CRITICAL)
      steps.deduplicateTable = await runStep('deduplicateTable', () =>
        deduplicateTable(client),
      );

      // Step 7: Validate timestamps (NON-CRITICAL)
      steps.validateTimestamps = await runStep('validateTimestamps', () =>
        validateTimestamps(client),
      );
      if (steps.validateTimestamps.status === 'success' && steps.validateTimestamps.result > 0) {
        warnings.push(`${steps.validateTimestamps.result} recent entries have epoch timestamps`);
      }
    }

    // Step 8: Get table stats (NON-CRITICAL)
    steps.getTableStats = await runStep('getTableStats', () =>
      getTableStats(client),
    );

    // Determine overall success: fail only if ALL critical steps failed
    const criticalStepNames = Array.from(CRITICAL_STEPS);
    const criticalResults = criticalStepNames
      .filter((name) => steps[name] !== undefined)
      .map((name) => steps[name]);
    const criticalFailures = criticalResults.filter((r) => r.status === 'failed');
    const allCriticalFailed = criticalResults.length > 0 && criticalFailures.length === criticalResults.length;

    // Collect non-critical failures as warnings
    const nonCriticalFailures = Object.entries(steps)
      .filter(([name, r]) => !CRITICAL_STEPS.has(name) && r.status === 'failed')
      .map(([name, r]) => `${name}: ${r.error}`);
    if (nonCriticalFailures.length > 0) {
      warnings.push(...nonCriticalFailures.map((f) => `Non-critical step failed: ${f}`));
    }

    // Warn about individual critical failures that didn't cause overall failure
    if (criticalFailures.length > 0 && !allCriticalFailed) {
      warnings.push(
        ...criticalStepNames
          .filter((name) => steps[name]?.status === 'failed')
          .map((name) => `Critical step failed: ${name}: ${steps[name].error}`),
      );
    }

    const durationMs = Date.now() - startTime;
    const stats = steps.getTableStats?.status === 'success' ? steps.getTableStats.result : null;
    const overallSuccess = !allCriticalFailed;

    await logCronExecution({
      cron_name: 'refresh-unified-incremental',
      status: overallSuccess ? 'success' : 'failure',
      duration_ms: durationMs,
      details: {
        activeConditions: activeConditions.length,
        processed: steps.processUnresolvedBatch?.result ?? 0,
        totalRows: stats?.total_rows,
        uniqueWallets: stats?.unique_wallets,
        epochTimestamps: stats?.epoch_timestamps,
        suspiciousTimestamps: steps.validateTimestamps?.result ?? 0,
        steps,
      },
      ...(allCriticalFailed
        ? { error_message: `All critical steps failed: ${criticalFailures.map((f) => f.error).join('; ')}` }
        : {}),
    });

    const httpStatus = overallSuccess ? 200 : 500;

    return NextResponse.json(
      {
        success: overallSuccess,
        activeConditions: activeConditions.length,
        processed: steps.processUnresolvedBatch?.result ?? 0,
        stats: stats
          ? {
              totalRows: stats.total_rows,
              uniqueWallets: stats.unique_wallets,
              unresolved: stats.unresolved,
              resolved: stats.resolved,
              epochTimestamps: stats.epoch_timestamps,
              latestEntry: stats.latest_entry,
              latestResolution: stats.latest_resolution,
            }
          : null,
        steps,
        warnings,
        _v: 5,
        duration: `${(durationMs / 1000).toFixed(1)}s`,
        timestamp: new Date().toISOString(),
      },
      { status: httpStatus },
    );
  } catch (error: any) {
    // This outer catch handles truly catastrophic failures (e.g., ClickHouse client init failure)
    const durationMs = Date.now() - startTime;
    console.error('[Cron] Unified incremental refresh catastrophic failure:', error);

    await logCronExecution({
      cron_name: 'refresh-unified-incremental',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message,
      details: { steps },
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        steps,
        _v: 5,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
