/**
 * Cron: Refresh WIO Metrics
 *
 * Daily refresh of wallet metrics across scopes and time windows.
 * Computes ROI, win rate, Brier score, etc. and stores in wio_wallet_metrics_v1.
 * Also computes smart money scores.
 *
 * Scopes: GLOBAL, per-CATEGORY, per-BUNDLE
 * Windows: 7d, 30d, 90d, ALL
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Daily (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface RefreshResult {
  success: boolean;
  walletsProcessed: number;
  metricsComputed: number;
  scoresUpdated: number;
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
    // Step 1: Ensure metrics table exists
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS wio_wallet_metrics_v1 (
          wallet_id String,
          scope String,           -- 'GLOBAL', 'CATEGORY:crypto', 'BUNDLE:bitcoin-price'
          time_window String,     -- '7d', '30d', '90d', 'ALL'

          -- Volume metrics
          total_positions UInt32,
          total_cost_usd Float64,
          total_pnl_usd Float64,

          -- Performance metrics
          roi Float64,
          win_rate Float64,
          avg_position_size Float64,

          -- Forecasting metrics
          avg_brier_score Nullable(Float64),
          resolved_positions UInt32,

          -- Timing metrics
          avg_hold_minutes Float64,

          -- CLV metrics (requires anchor prices)
          avg_clv_4h Nullable(Float64),
          avg_clv_24h Nullable(Float64),

          -- Metadata
          computed_at DateTime DEFAULT now(),

          PRIMARY KEY (wallet_id, scope, time_window)
        ) ENGINE = ReplacingMergeTree(computed_at)
        ORDER BY (wallet_id, scope, time_window)
      `,
    });

    // Step 2: Compute GLOBAL metrics for ALL time window
    // This is the most important metric set
    const globalQuery = `
      INSERT INTO wio_wallet_metrics_v1 (
        wallet_id, scope, time_window,
        total_positions, total_cost_usd, total_pnl_usd,
        roi, win_rate, avg_position_size,
        avg_brier_score, resolved_positions,
        avg_hold_minutes, avg_clv_4h, avg_clv_24h
      )
      SELECT
        wallet_id,
        'GLOBAL' as scope,
        'ALL' as time_window,

        count() as total_positions,
        sum(cost_usd) as total_cost_usd,
        sum(pnl_usd) as total_pnl_usd,

        if(sum(cost_usd) > 0, sum(pnl_usd) / sum(cost_usd), 0) as roi,
        countIf(pnl_usd > 0) / count() as win_rate,
        avg(cost_usd) as avg_position_size,

        avgIf(brier_score, brier_score IS NOT NULL) as avg_brier_score,
        countIf(is_resolved = 1) as resolved_positions,

        avg(hold_minutes) as avg_hold_minutes,
        NULL as avg_clv_4h,  -- Anchor prices not captured in v1
        NULL as avg_clv_24h  -- Anchor prices not captured in v1

      FROM wio_positions_v1
      GROUP BY wallet_id
      HAVING total_positions >= 5  -- Minimum activity threshold
    `;

    await clickhouse.command({ query: globalQuery });

    // Step 3: Compute GLOBAL metrics for time windows (30d, 90d)
    for (const days of [30, 90]) {
      const windowQuery = `
        INSERT INTO wio_wallet_metrics_v1 (
          wallet_id, scope, time_window,
          total_positions, total_cost_usd, total_pnl_usd,
          roi, win_rate, avg_position_size,
          avg_brier_score, resolved_positions,
          avg_hold_minutes, avg_clv_4h, avg_clv_24h
        )
        SELECT
          wallet_id,
          'GLOBAL' as scope,
          '${days}d' as time_window,

          count() as total_positions,
          sum(cost_usd) as total_cost_usd,
          sum(pnl_usd) as total_pnl_usd,

          if(sum(cost_usd) > 0, sum(pnl_usd) / sum(cost_usd), 0) as roi,
          countIf(pnl_usd > 0) / count() as win_rate,
          avg(cost_usd) as avg_position_size,

          avgIf(brier_score, brier_score IS NOT NULL) as avg_brier_score,
          countIf(is_resolved = 1) as resolved_positions,

          avg(hold_minutes) as avg_hold_minutes,
          NULL as avg_clv_4h,  -- Anchor prices not captured in v1
          NULL as avg_clv_24h  -- Anchor prices not captured in v1

        FROM wio_positions_v1
        WHERE ts_open >= now() - INTERVAL ${days} DAY
        GROUP BY wallet_id
        HAVING total_positions >= 3
      `;
      await clickhouse.command({ query: windowQuery });
    }

    // Step 4: Compute per-CATEGORY metrics
    const categoryQuery = `
      INSERT INTO wio_wallet_metrics_v1 (
        wallet_id, scope, time_window,
        total_positions, total_cost_usd, total_pnl_usd,
        roi, win_rate, avg_position_size,
        avg_brier_score, resolved_positions,
        avg_hold_minutes, avg_clv_4h, avg_clv_24h
      )
      SELECT
        wallet_id,
        concat('CATEGORY:', category) as scope,
        'ALL' as time_window,

        count() as total_positions,
        sum(cost_usd) as total_cost_usd,
        sum(pnl_usd) as total_pnl_usd,

        if(sum(cost_usd) > 0, sum(pnl_usd) / sum(cost_usd), 0) as roi,
        countIf(pnl_usd > 0) / count() as win_rate,
        avg(cost_usd) as avg_position_size,

        avgIf(brier_score, brier_score IS NOT NULL) as avg_brier_score,
        countIf(is_resolved = 1) as resolved_positions,

        avg(hold_minutes) as avg_hold_minutes,
        NULL as avg_clv_4h,  -- Anchor prices not captured in v1
        NULL as avg_clv_24h  -- Anchor prices not captured in v1

      FROM wio_positions_v1
      WHERE category != ''
      GROUP BY wallet_id, category
      HAVING total_positions >= 3
    `;
    await clickhouse.command({ query: categoryQuery });

    // Step 5: Compute smart money scores
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS wio_wallet_scores_v1 (
          wallet_id String,
          composite_score Float64,
          roi_percentile Float64,
          brier_percentile Float64,
          volume_percentile Float64,
          consistency_score Float64,
          rank UInt32,
          tier String,  -- 'S', 'A', 'B', 'C'
          computed_at DateTime DEFAULT now(),
          PRIMARY KEY (wallet_id)
        ) ENGINE = ReplacingMergeTree(computed_at)
        ORDER BY wallet_id
      `,
    });

    const scoreQuery = `
      INSERT INTO wio_wallet_scores_v1 (
        wallet_id, composite_score, roi_percentile, brier_percentile,
        volume_percentile, consistency_score, rank, tier
      )
      WITH
        base_metrics AS (
          SELECT
            wallet_id,
            roi,
            avg_brier_score,
            total_cost_usd,
            win_rate
          FROM wio_wallet_metrics_v1
          WHERE scope = 'GLOBAL' AND time_window = 'ALL'
            AND total_positions >= 10
            AND total_cost_usd >= 100
        ),
        percentiles AS (
          SELECT
            wallet_id,
            roi,
            avg_brier_score,
            total_cost_usd,
            win_rate,
            percent_rank() OVER (ORDER BY roi) as roi_pct,
            percent_rank() OVER (ORDER BY avg_brier_score DESC) as brier_pct,
            percent_rank() OVER (ORDER BY total_cost_usd) as volume_pct
          FROM base_metrics
        ),
        scored AS (
          SELECT
            wallet_id,
            roi_pct * 0.35 + brier_pct * 0.35 + volume_pct * 0.15 + win_rate * 0.15 as composite,
            roi_pct,
            brier_pct,
            volume_pct,
            win_rate
          FROM percentiles
        )
      SELECT
        wallet_id,
        composite as composite_score,
        roi_pct as roi_percentile,
        brier_pct as brier_percentile,
        volume_pct as volume_percentile,
        win_rate as consistency_score,
        row_number() OVER (ORDER BY composite DESC) as rank,
        CASE
          WHEN composite >= 0.9 THEN 'S'
          WHEN composite >= 0.75 THEN 'A'
          WHEN composite >= 0.5 THEN 'B'
          ELSE 'C'
        END as tier
      FROM scored
      ORDER BY composite DESC
    `;
    await clickhouse.command({ query: scoreQuery });

    // Step 6: Get counts
    const metricsCount = await clickhouse.query({
      query: `SELECT count() as cnt FROM wio_wallet_metrics_v1`,
      format: 'JSONEachRow',
    });
    const metricsComputed = Number(((await metricsCount.json()) as any[])[0]?.cnt || 0);

    const walletsCount = await clickhouse.query({
      query: `SELECT uniqExact(wallet_id) as cnt FROM wio_wallet_metrics_v1`,
      format: 'JSONEachRow',
    });
    const walletsProcessed = Number(((await walletsCount.json()) as any[])[0]?.cnt || 0);

    const scoresCount = await clickhouse.query({
      query: `SELECT count() as cnt FROM wio_wallet_scores_v1`,
      format: 'JSONEachRow',
    });
    const scoresUpdated = Number(((await scoresCount.json()) as any[])[0]?.cnt || 0);

    const durationMs = Date.now() - startTime;
    const result: RefreshResult = {
      success: true,
      walletsProcessed,
      metricsComputed,
      scoresUpdated,
      durationMs,
    };

    await logCronExecution({
      cron_name: 'refresh-wio-metrics',
      status: 'success',
      duration_ms: durationMs,
      details: { walletsProcessed, metricsComputed, scoresUpdated }
    });

    console.log(`[refresh-wio-metrics] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[refresh-wio-metrics] Error:', error);

    await logCronExecution({
      cron_name: 'refresh-wio-metrics',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    });

    return NextResponse.json({
      success: false,
      walletsProcessed: 0,
      metricsComputed: 0,
      scoresUpdated: 0,
      durationMs,
      error: error.message,
    } as RefreshResult, { status: 500 });
  }
}
