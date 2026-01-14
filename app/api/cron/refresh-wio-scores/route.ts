/**
 * Cron: Refresh WIO Scores
 *
 * Daily computation of wallet scores and dot events.
 *
 * Scores computed:
 * - Credibility: How trustworthy is this forecaster?
 * - Bot Likelihood: Is this wallet automated/MM?
 * - Copyability: How easy is it to follow this wallet?
 *
 * Also generates dot events for significant moves by credible wallets.
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Daily at 7 AM UTC (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 180;

interface ScoresResult {
  success: boolean;
  scoresComputed: number;
  dotsGenerated: number;
  superforecasters: number;
  smartMoney: number;
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
    // Step 1: Truncate existing scores for fresh computation
    await clickhouse.command({ query: 'TRUNCATE TABLE wio_wallet_scores_v1' });

    // Step 2: Compute wallet scores from metrics
    // Join 90d window with ALL window to penalize lifetime losers
    const scoresQuery = `
      INSERT INTO wio_wallet_scores_v1
      SELECT
        m90.wallet_id,
        2 as window_id,  -- 90d

        -- Credibility Score (0-1) with ALL-time performance penalty + Edge significance
        (
          (
            0.25 * least(greatest(m90.roi_cost_weighted, 0), 1.0) +
            0.25 * IF(m90.win_rate > 0.5, (m90.win_rate - 0.5) * 2, 0)
          ) +
          (
            0.3 * IF(m90.profit_factor > 1 AND m90.profit_factor < 999,
              least((m90.profit_factor - 1) / 3, 1),
              0
            )
          ) +
          (
            0.2 * IF(m90.max_loss_roi > -1, 1, greatest(0, 1 + m90.max_loss_roi))
          )
        ) *
        (m90.resolved_positions_n / (m90.resolved_positions_n + 20.0)) *
        IF(m90.fills_per_day >= 100, 0.3, IF(m90.fills_per_day >= 50, 0.7, 1.0)) *
        -- ALL-TIME PENALTY: reduce score if lifetime ROI is negative
        IF(mAll.roi_cost_weighted >= 0, 1.0,
          greatest(0.1, 1.0 + mAll.roi_cost_weighted)
        ) *
        -- EDGE SIGNIFICANCE PENALTY: Require real edge, not just high win rate
        -- High win rate with profit_factor ~1.0 = tiny wins, big losses = NO real edge
        IF(m90.profit_factor >= 1.2, 1.0,
          IF(m90.profit_factor > 1.0,
            0.15 + 0.85 * (m90.profit_factor - 1.0) / 0.2,  -- 1.0 -> 0.15, 1.2 -> 1.0
            0.15  -- break-even or worse = 15% of base score
          )
        )
        as credibility_score,

        -- Bot Likelihood (0-1)
        least(1.0,
          0.4 * least(m90.fills_per_day / 100.0, 1.0) +
          0.3 * IF(m90.hold_minutes_p50 < 60 AND m90.hold_minutes_p50 > 0,
            1 - m90.hold_minutes_p50 / 60.0,
            0
          ) +
          0.3 * IF(m90.active_days_n > 0 AND m90.positions_n / m90.active_days_n > 50,
            least((m90.positions_n / m90.active_days_n - 50) / 100.0, 1.0),
            0
          )
        ) as bot_likelihood,

        -- Copyability Score (0-1)
        (
          0.3 * IF(m90.hold_minutes_p50 >= 60, 1, IF(m90.hold_minutes_p50 > 0, m90.hold_minutes_p50 / 60.0, 0)) +
          0.25 * IF(m90.max_loss_roi > -0.5, 1, greatest(0, 1 + 2 * m90.max_loss_roi)) +
          0.25 * IF(m90.win_rate > 0.4, least((m90.win_rate - 0.4) / 0.3, 1), 0) +
          0.2 * IF(m90.fills_per_day < 50, 1, greatest(0, 1 - (m90.fills_per_day - 50) / 50.0))
        ) as copyability_score,

        -- Component breakdowns
        0.25 * least(greatest(m90.roi_cost_weighted, 0), 1.0) +
        0.25 * IF(m90.win_rate > 0.5, (m90.win_rate - 0.5) * 2, 0) as skill_component,

        0.3 * IF(m90.profit_factor > 1 AND m90.profit_factor < 999, least((m90.profit_factor - 1) / 3, 1), 0) as consistency_component,

        m90.resolved_positions_n / (m90.resolved_positions_n + 20.0) as sample_size_factor,

        0.4 * least(m90.fills_per_day / 100.0, 1.0) as fill_rate_signal,
        0.3 * IF(m90.hold_minutes_p50 < 60 AND m90.hold_minutes_p50 > 0, 1 - m90.hold_minutes_p50 / 60.0, 0) as scalper_signal,

        0.3 * IF(m90.hold_minutes_p50 >= 60, 1, IF(m90.hold_minutes_p50 > 0, m90.hold_minutes_p50 / 60.0, 0)) as horizon_component,
        0.25 * IF(m90.max_loss_roi > -0.5, 1, greatest(0, 1 + 2 * m90.max_loss_roi)) as risk_component,

        now() as computed_at

      FROM wio_metric_observations_v1 m90
      INNER JOIN wio_metric_observations_v1 mAll
        ON m90.wallet_id = mAll.wallet_id
        AND mAll.scope_type = 'GLOBAL'
        AND mAll.window_id = 1  -- ALL window
      WHERE m90.scope_type = 'GLOBAL'
        AND m90.window_id = 2  -- 90d
        AND m90.positions_n >= 5
    `;

    await clickhouse.command({ query: scoresQuery });

    // Count scores
    const scoresCount = await clickhouse.query({
      query: 'SELECT count() as cnt FROM wio_wallet_scores_v1 WHERE window_id = 2',
      format: 'JSONEachRow',
    });
    const scoresComputed = Number(((await scoresCount.json()) as any[])[0]?.cnt || 0);

    // Step 3: Generate dot events for recent smart money moves
    // Clear recent dots first
    await clickhouse.command({
      query: `ALTER TABLE wio_dot_events_v1 DELETE WHERE created_at >= now() - INTERVAL 1 HOUR`
    });

    const dotsQuery = `
      INSERT INTO wio_dot_events_v1
      SELECT
        toString(cityHash64(concat(p.wallet_id, p.condition_id, toString(p.ts_open)))) as dot_id,
        p.ts_open as ts,
        p.wallet_id,
        p.condition_id as market_id,
        p.primary_bundle_id as bundle_id,
        'ENTER' as action,
        p.side,
        p.cost_usd as size_usd,
        CASE
          WHEN s.credibility_score >= 0.5 THEN 'SUPERFORECASTER'
          ELSE 'SMART_MONEY'
        END as dot_type,
        s.credibility_score as confidence,
        arrayFilter(x -> x != '', [
          IF(s.credibility_score >= 0.5, 'high_credibility', ''),
          IF(s.skill_component >= 0.3, 'high_skill', ''),
          IF(s.sample_size_factor >= 0.7, 'large_sample', ''),
          IF(p.cost_usd >= 1000, 'large_position', '')
        ]) as reason_metrics,
        s.credibility_score,
        s.bot_likelihood,
        ifNull(mp.mark_price, 0.5) as crowd_odds,
        p.p_entry_side as entry_price,
        now() as created_at

      FROM wio_positions_v2 p
      INNER JOIN wio_wallet_scores_v1 s ON p.wallet_id = s.wallet_id AND s.window_id = 2
      LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id
      WHERE p.ts_open >= now() - INTERVAL 7 DAY
        AND s.credibility_score >= 0.3
        AND s.bot_likelihood < 0.5
        AND p.cost_usd >= 100
        AND p.is_resolved = 0
    `;

    await clickhouse.command({ query: dotsQuery });

    // Count dots
    const dotsCount = await clickhouse.query({
      query: `SELECT count() as cnt FROM wio_dot_events_v1 WHERE created_at >= now() - INTERVAL 1 MINUTE`,
      format: 'JSONEachRow',
    });
    const dotsGenerated = Number(((await dotsCount.json()) as any[])[0]?.cnt || 0);

    // Get tier counts
    const tierCount = await clickhouse.query({
      query: `
        SELECT
          countIf(credibility_score >= 0.5 AND bot_likelihood < 0.5) as superforecasters,
          countIf(credibility_score >= 0.3 AND credibility_score < 0.5 AND bot_likelihood < 0.5) as smart_money
        FROM wio_wallet_scores_v1
        WHERE window_id = 2
      `,
      format: 'JSONEachRow',
    });
    const tiers = (await tierCount.json() as any[])[0];
    const superforecasters = Number(tiers?.superforecasters || 0);
    const smartMoney = Number(tiers?.smart_money || 0);

    const durationMs = Date.now() - startTime;
    const result: ScoresResult = {
      success: true,
      scoresComputed,
      dotsGenerated,
      superforecasters,
      smartMoney,
      durationMs,
    };

    await logCronExecution({
      cron_name: 'refresh-wio-scores',
      status: 'success',
      duration_ms: durationMs,
      details: { scoresComputed, dotsGenerated, superforecasters, smartMoney }
    });

    console.log(`[refresh-wio-scores] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[refresh-wio-scores] Error:', error);

    await logCronExecution({
      cron_name: 'refresh-wio-scores',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    });

    return NextResponse.json({
      success: false,
      scoresComputed: 0,
      dotsGenerated: 0,
      superforecasters: 0,
      smartMoney: 0,
      durationMs,
      error: error.message,
    } as ScoresResult, { status: 500 });
  }
}
