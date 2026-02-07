/**
 * Cron: Refresh Unified FIFO Table (Production)
 *
 * Updates pm_trade_fifo_roi_v3_mat_unified with newly resolved positions.
 * Uses LEFT JOIN anti-pattern to avoid inserting duplicates.
 * Skips expensive OPTIMIZE (relies on natural background deduplication).
 *
 * Schedule: Daily at 5:00 AM UTC
 * Timeout: 10 minutes
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const maxDuration = 600; // 10 minutes
export const dynamic = 'force-dynamic';

const LOOKBACK_HOURS = 168; // 7 days (matches refresh-fifo-trades and refresh-unified-incremental)

async function refreshUnifiedTable(client: any) {
  // Step 1: Get current state
  const beforeResult = await client.query({
    query: `
      SELECT
        toString(max(resolved_at)) as latest_resolution,
        dateDiff('hour', max(resolved_at), now()) as hours_stale
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const before = await beforeResult.json() as any;

  // Step 2: Insert resolved positions from v3 that aren't in unified yet.
  // Uses NOT IN on condition_id (much smaller set) instead of LEFT JOIN
  // which loads the entire 300M+ row unified table and OOMs at 10.80 GiB.
  // Unified is ReplacingMergeTree, so any duplicate rows from re-inserts
  // are handled by background merges.
  const insertQuery = `
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
    FROM pm_trade_fifo_roi_v3 AS v
    WHERE v.condition_id IN (
      SELECT DISTINCT condition_id
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND resolved_at != '0000-00-00 00:00:00'
        AND condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3_mat_unified
        )
    )
  `;

  await client.command({
    query: insertQuery,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Step 3: Get final state
  const afterResult = await client.query({
    query: `
      SELECT
        toString(max(resolved_at)) as latest_resolution,
        dateDiff('hour', max(resolved_at), now()) as hours_stale,
        formatReadableQuantity(count()) as total_rows
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const after = await afterResult.json() as any;

  return {
    before_latest_resolution: before[0].latest_resolution,
    before_hours_stale: before[0].hours_stale,
    after_latest_resolution: after[0].latest_resolution,
    after_hours_stale: after[0].hours_stale,
    total_rows: after[0].total_rows,
  };
}

export async function GET(request: NextRequest) {
  const authResult = verifyCronRequest(request, 'refresh-unified-final');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    console.log('[Cron] Starting unified table refresh');

    const stats = await refreshUnifiedTable(client);

    const durationMs = Date.now() - startTime;

    console.log('[Cron] Unified table refreshed successfully');
    console.log(`[Cron] Before: ${stats.before_latest_resolution} (${stats.before_hours_stale}h stale)`);
    console.log(`[Cron] After: ${stats.after_latest_resolution} (${stats.after_hours_stale}h stale)`);

    await logCronExecution({
      cron_name: 'refresh-unified-final',
      status: 'success',
      duration_ms: durationMs,
      details: stats,
    });

    return NextResponse.json({
      success: true,
      stats,
      duration: `${(durationMs / 1000).toFixed(1)}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[Cron] Unified table refresh failed:', error);

    await logCronExecution({
      cron_name: 'refresh-unified-final',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message,
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
