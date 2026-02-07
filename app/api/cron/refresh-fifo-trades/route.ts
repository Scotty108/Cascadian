/**
 * Cron: Refresh FIFO Trades
 *
 * Processes recently resolved conditions to keep pm_trade_fifo_roi_v3 current.
 * Handles both LONG and SHORT positions.
 *
 * Two-phase approach:
 * 1. PRIMARY: Process conditions resolved in the last 7 days (catches normal flow + short outages)
 * 2. CATCH-UP: If primary finds fewer than budget, sweep for ANY missed conditions regardless
 *    of resolution time (prevents conditions from being permanently missed)
 *
 * IMPORTANT: Extracts order_id from fill_id to enable accurate trade counting.
 * One order_id = one trading decision, even if filled by multiple takers.
 * fill_id format: clob_{tx_hash}_{order_id}-{m/t}
 *
 * Schedule: Every 2 hours (0 *\/2 * * *)
 * Timeout: 10 minutes (max for Vercel Pro)
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export const maxDuration = 600; // 10 minutes
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;
const PRIMARY_LOOKBACK_HOURS = 168; // 7 days - catches conditions missed during outages
const MAX_CONDITIONS_PER_RUN = 2000;
const CATCHUP_BUDGET = 500; // Extra conditions to process from older missed resolutions

async function getRecentlyResolvedConditions(client: any): Promise<string[]> {
  // Phase 1: Get conditions resolved in the last 7 days that aren't in FIFO yet
  // Uses NOT IN subqueries (condition-level, ~300K distinct values) instead of
  // LEFT JOIN which loads 284M rows and OOMs at 10.80 GiB memory limit
  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND resolved_at >= now() - INTERVAL ${PRIMARY_LOOKBACK_HOURS} HOUR
        AND condition_id IN (
          SELECT DISTINCT condition_id FROM pm_canonical_fills_v4 WHERE source = 'clob'
        )
        AND condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
        )
      LIMIT ${MAX_CONDITIONS_PER_RUN}
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const rows = (await result.json()) as { condition_id: string }[];
  return rows.map((r) => r.condition_id);
}

async function getCatchUpConditions(client: any, alreadyQueued: Set<string>): Promise<string[]> {
  // Phase 2: Sweep for ANY resolved conditions not in FIFO, regardless of resolution time.
  // This catches conditions permanently missed by the lookback window (e.g., during recovery).
  // Uses NOT IN subqueries instead of LEFT JOIN to avoid 10.80 GiB OOM
  const result = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators != ''
        AND resolved_at < now() - INTERVAL ${PRIMARY_LOOKBACK_HOURS} HOUR
        AND condition_id IN (
          SELECT DISTINCT condition_id FROM pm_canonical_fills_v4 WHERE source = 'clob'
        )
        AND condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
        )
      LIMIT ${CATCHUP_BUDGET}
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const rows = (await result.json()) as { condition_id: string }[];
  return rows.map((r) => r.condition_id).filter((id) => !alreadyQueued.has(id));
}

async function getFifoHealthMetrics(client: any): Promise<{
  totalFifoRows: number;
  totalFifoConditions: number;
  missedRecent: number;
  missedOlder: number;
}> {
  // Uses NOT IN subqueries instead of LEFT JOIN to avoid 10.80 GiB OOM
  const result = await client.query({
    query: `
      SELECT
        (SELECT count() FROM pm_trade_fifo_roi_v3) as total_fifo_rows,
        (SELECT countDistinct(condition_id) FROM pm_trade_fifo_roi_v3) as total_fifo_conditions,
        (SELECT count(DISTINCT condition_id)
         FROM pm_condition_resolutions
         WHERE is_deleted = 0 AND payout_numerators != ''
           AND resolved_at >= now() - INTERVAL ${PRIMARY_LOOKBACK_HOURS} HOUR
           AND condition_id NOT IN (
             SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
           )
        ) as missed_recent,
        (SELECT count(DISTINCT condition_id)
         FROM pm_condition_resolutions
         WHERE is_deleted = 0 AND payout_numerators != ''
           AND resolved_at < now() - INTERVAL ${PRIMARY_LOOKBACK_HOURS} HOUR
           AND condition_id NOT IN (
             SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
           )
        ) as missed_older
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const rows = (await result.json()) as any[];
  return rows[0];
}

async function processLongPositions(client: any, conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map((id) => `'${id}'`).join(',');

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

  await client.command({ query, clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 } });
  return conditionIds.length;
}

async function processShortPositions(client: any, conditionIds: string[]): Promise<number> {
  if (conditionIds.length === 0) return 0;

  const conditionList = conditionIds.map((id) => `'${id}'`).join(',');

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
          -- Extract order_id from fill_id: clob_{tx_hash}_{order_id}-{m/t}
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

  await client.command({ query, clickhouse_settings: { max_execution_time: 300, join_use_nulls: 1 } });
  return conditionIds.length;
}

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-fifo-trades');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    // Phase 1: Get recently resolved conditions (7-day window)
    const recentConditions = await getRecentlyResolvedConditions(client);
    const recentSet = new Set(recentConditions);

    // Phase 2: If budget remains, sweep for older missed conditions (catch-up)
    let catchUpConditions: string[] = [];
    if (recentConditions.length < MAX_CONDITIONS_PER_RUN) {
      catchUpConditions = await getCatchUpConditions(client, recentSet);
    }

    const allConditions = [...recentConditions, ...catchUpConditions];

    if (allConditions.length === 0) {
      // Report health even when nothing to process
      const health = await getFifoHealthMetrics(client);
      return NextResponse.json({
        success: true,
        message: 'No new conditions to process',
        processed: 0,
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        timestamp: new Date().toISOString(),
        health,
      });
    }

    let totalProcessed = 0;
    let errors = 0;
    const failedBatches: number[] = [];

    // Process in batches
    for (let i = 0; i < allConditions.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = allConditions.slice(i, i + BATCH_SIZE);

      try {
        await processLongPositions(client, batch);
        await processShortPositions(client, batch);
        totalProcessed += batch.length;
      } catch (err: any) {
        errors++;
        failedBatches.push(batchNum);
        console.error(`Batch ${batchNum} error (${batch.length} conditions):`, err.message);
      }
    }

    const duration = (Date.now() - startTime) / 1000;

    // Collect health metrics after processing
    const health = await getFifoHealthMetrics(client);

    return NextResponse.json({
      success: true,
      recentConditionsFound: recentConditions.length,
      catchUpConditionsFound: catchUpConditions.length,
      totalProcessed,
      errors,
      ...(failedBatches.length > 0 && { failedBatches }),
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString(),
      health,
    });
  } catch (error) {
    console.error('FIFO refresh failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
