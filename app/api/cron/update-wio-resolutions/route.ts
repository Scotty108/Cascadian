/**
 * Cron: Update WIO Resolutions
 *
 * Updates positions when markets resolve.
 * - Sets is_resolved = 1
 * - Sets outcome_side (0 or 1)
 * - Recalculates final PnL and Brier score
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Daily (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

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

    // Step 2: Update positions with resolution data
    // Note: ClickHouse doesn't support UPDATE with JOIN directly,
    // so we need to use ALTER TABLE UPDATE with a subquery
    const updateQuery = `
      ALTER TABLE wio_positions_v1
      UPDATE
        is_resolved = 1,
        ts_resolve = res.resolved_at,
        end_ts = res.resolved_at,
        outcome_side = res.outcome,
        pnl_usd = (proceeds_usd - cost_usd) + if(res.outcome = 1, qty_shares_remaining, 0),
        roi = if(cost_usd > 0, ((proceeds_usd - cost_usd) + if(res.outcome = 1, qty_shares_remaining, 0)) / cost_usd, 0),
        hold_minutes = dateDiff('minute', ts_open, res.resolved_at),
        brier_score = if(qty_shares_opened > 0, pow(p_entry_side - res.outcome, 2), NULL)
      FROM (
        SELECT
          p.position_id,
          r.resolved_at,
          toInt64OrNull(JSONExtractString(r.payout_numerators, if(p.side = 'YES', 1, 2))) as outcome
        FROM wio_positions_v1 p
        INNER JOIN pm_condition_resolutions r
          ON p.market_id = r.condition_id
          AND r.is_deleted = 0
          AND r.resolved_at > '1970-01-02'
        WHERE p.is_resolved = 0
      ) as res
      WHERE wio_positions_v1.position_id = res.position_id
    `;

    await clickhouse.command({ query: updateQuery });

    const result: UpdateResult = {
      success: true,
      positionsUpdated: positionsToUpdate,
      marketsResolved,
      durationMs: Date.now() - startTime,
    };

    console.log(`[update-wio-resolutions] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[update-wio-resolutions] Error:', error);
    return NextResponse.json({
      success: false,
      positionsUpdated: 0,
      marketsResolved: 0,
      durationMs: Date.now() - startTime,
      error: error.message,
    } as UpdateResult, { status: 500 });
  }
}
