/**
 * Cron: Update WIO Resolutions
 *
 * Updates positions when markets resolve.
 * - Sets is_resolved = 1
 * - Sets outcome_side (0 or 1)
 * - Recalculates final PnL and Brier score
 *
 * Uses INSERT with ReplacingMergeTree deduplication instead of ALTER TABLE UPDATE
 * (ClickHouse ALTER TABLE UPDATE doesn't support correlated subqueries well)
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Daily (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface UpdateResult {
  success: boolean;
  positionsUpdated: number;
  marketsResolved: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret && !isProduction) return true;
  if (!cronSecret && isProduction) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('token') === cronSecret) return true;

  return false;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find positions that:
    // 1. Have is_resolved = 0
    // 2. Their market now has a resolution in pm_condition_resolutions

    // Step 1: Count how many positions need updating
    const countResult = await clickhouse.query({
      query: `
        SELECT
          count() as positions,
          uniqExact(p.market_id) as markets
        FROM wio_positions_v1 p
        INNER JOIN pm_condition_resolutions r
          ON p.market_id = r.condition_id
          AND r.is_deleted = 0
          AND r.resolved_at > '1970-01-02'
        WHERE p.is_resolved = 0
      `,
      format: 'JSONEachRow',
    });
    const counts = ((await countResult.json()) as any[])[0];
    const positionsToUpdate = Number(counts?.positions || 0);
    const marketsResolved = Number(counts?.markets || 0);

    console.log(`[update-wio-resolutions] Found ${positionsToUpdate} positions to update across ${marketsResolved} markets`);

    if (positionsToUpdate === 0) {
      return NextResponse.json({
        success: true,
        positionsUpdated: 0,
        marketsResolved: 0,
        durationMs: Date.now() - startTime,
      } as UpdateResult);
    }

    // Step 2: Insert updated positions (ReplacingMergeTree will dedupe by position_id)
    // Using INSERT ... SELECT with JOIN to compute all values properly
    const insertQuery = `
      INSERT INTO wio_positions_v1 (
        position_id, wallet_id, market_id, side, category,
        ts_open, ts_close, ts_resolve, end_ts,
        qty_shares_opened, qty_shares_closed, qty_shares_remaining,
        cost_usd, proceeds_usd, fees_usd,
        p_entry_side, p_anchor_4h_side, p_anchor_24h_side, p_anchor_72h_side,
        is_resolved, outcome_side,
        pnl_usd, roi, hold_minutes,
        clv_4h, clv_24h, clv_72h, brier_score,
        fills_count, first_fill_id, last_fill_id,
        created_at, updated_at, event_id
      )
      SELECT
        p.position_id,
        p.wallet_id,
        p.market_id,
        p.side,
        p.category,
        p.ts_open,
        p.ts_close,
        r.resolved_at as ts_resolve,
        r.resolved_at as end_ts,
        p.qty_shares_opened,
        p.qty_shares_closed,
        p.qty_shares_remaining,
        p.cost_usd,
        p.proceeds_usd,
        p.fees_usd,
        p.p_entry_side,
        p.p_anchor_4h_side,
        p.p_anchor_24h_side,
        p.p_anchor_72h_side,
        1 as is_resolved,
        toInt64OrNull(JSONExtractString(r.payout_numerators, if(p.side = 'YES', 1, 2))) as outcome_side,
        -- PnL: proceeds - cost + (shares remaining * payout if won)
        (p.proceeds_usd - p.cost_usd) + if(
          toInt64OrNull(JSONExtractString(r.payout_numerators, if(p.side = 'YES', 1, 2))) = 1,
          p.qty_shares_remaining, 0
        ) as pnl_usd,
        -- ROI: pnl / cost
        if(p.cost_usd > 0,
          ((p.proceeds_usd - p.cost_usd) + if(
            toInt64OrNull(JSONExtractString(r.payout_numerators, if(p.side = 'YES', 1, 2))) = 1,
            p.qty_shares_remaining, 0
          )) / p.cost_usd, 0
        ) as roi,
        dateDiff('minute', p.ts_open, r.resolved_at) as hold_minutes,
        p.clv_4h,
        p.clv_24h,
        p.clv_72h,
        -- Brier score: (entry_price - outcome)^2
        if(p.qty_shares_opened > 0,
          pow(p.p_entry_side - toFloat64OrNull(JSONExtractString(r.payout_numerators, if(p.side = 'YES', 1, 2))), 2),
          NULL
        ) as brier_score,
        p.fills_count,
        p.first_fill_id,
        p.last_fill_id,
        p.created_at,
        now() as updated_at,
        p.event_id
      FROM wio_positions_v1 p
      INNER JOIN pm_condition_resolutions r
        ON p.market_id = r.condition_id
        AND r.is_deleted = 0
        AND r.resolved_at > '1970-01-02'
      WHERE p.is_resolved = 0
    `;

    await clickhouse.command({ query: insertQuery });

    const durationMs = Date.now() - startTime;
    const result: UpdateResult = {
      success: true,
      positionsUpdated: positionsToUpdate,
      marketsResolved,
      durationMs,
    };

    await logCronExecution({
      cron_name: 'update-wio-resolutions',
      status: 'success',
      duration_ms: durationMs,
      details: { positionsUpdated: positionsToUpdate, marketsResolved }
    });

    console.log(`[update-wio-resolutions] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[update-wio-resolutions] Error:', error);

    await logCronExecution({
      cron_name: 'update-wio-resolutions',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    });

    return NextResponse.json({
      success: false,
      positionsUpdated: 0,
      marketsResolved: 0,
      durationMs,
      error: error.message,
    } as UpdateResult, { status: 500 });
  }
}
