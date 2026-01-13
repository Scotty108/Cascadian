/**
 * API: Get WIO Wallet Profile
 *
 * Returns comprehensive wallet profile with scores, metrics, positions, and signals.
 *
 * Path: /api/wio/wallet/[address]
 * Query params:
 * - window: Time window for metrics ('ALL' | '90d' | '30d') - default 'ALL'
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

// Type definitions
interface WalletScore {
  credibility_score: number;
  bot_likelihood: number;
  copyability_score: number;
  skill_component: number;
  consistency_component: number;
  sample_size_factor: number;
  fill_rate_signal: number;
  scalper_signal: number;
  horizon_component: number;
  risk_component: number;
  window_id: string;
}

interface WalletClassification {
  tier: string;
  roi_cost_weighted: number;
  win_rate: number;
  pnl_total_usd: number;
  resolved_positions_n: number;
  fills_per_day: number;
  credibility_score: number;
  bot_likelihood: number;
}

interface WalletMetrics {
  scope_type: string;
  scope_id: string;
  window_id: string;
  positions_n: number;
  resolved_positions_n: number;
  fills_n: number;
  active_days_n: number;
  wallet_age_days: number | null;
  days_since_last_trade: number | null;
  roi_cost_weighted: number;
  pnl_total_usd: number;
  roi_p50: number;
  roi_p05: number;
  roi_p95: number;
  win_rate: number;
  avg_win_roi: number;
  avg_loss_roi: number;
  profit_factor: number;
  max_drawdown_usd: number;
  cvar_95_roi: number;
  max_loss_roi: number;
  loss_streak_max: number;
  hold_minutes_p50: number;
  pct_held_to_resolve: number;
  time_to_resolve_hours_p50: number;
  clv_4h_cost_weighted: number;
  clv_24h_cost_weighted: number;
  clv_72h_cost_weighted: number;
  clv_24h_win_rate: number;
  brier_mean: number;
  brier_vs_crowd: number;
  sharpness: number;
  calibration_gap: number;
  market_hhi_cost: number;
  position_cost_p50: number;
  position_cost_p90: number;
  fills_per_day: number;
}

interface OpenPosition {
  market_id: string;
  question: string;
  category: string;
  side: string;
  open_shares_net: number;
  open_cost_usd: number;
  avg_entry_price: number;
  mark_price: number;
  unrealized_pnl_usd: number;
  unrealized_roi: number;
  bundle_id: string;
  as_of_ts: string;
}

interface ClosedPosition {
  position_id: string;
  market_id: string;
  question: string;
  category: string;
  side: string;
  cost_usd: number;
  proceeds_usd: number;
  pnl_usd: number;
  roi: number;
  hold_minutes: number;
  brier_score: number | null;
  is_resolved: number;
  ts_open: string;
  ts_close: string | null;
  ts_resolve: string | null;
}

interface DotEvent {
  dot_id: string;
  ts: string;
  market_id: string;
  question: string;
  action: string;
  side: string;
  size_usd: number;
  dot_type: string;
  confidence: number;
  reason_metrics: string[];
  entry_price: number;
  crowd_odds: number;
}

interface CategoryMetrics {
  scope_id: string;
  bundle_name: string;
  positions_n: number;
  resolved_positions_n: number;
  pnl_total_usd: number;
  roi_cost_weighted: number;
  win_rate: number;
  brier_mean: number;
}

interface WalletProfile {
  wallet_id: string;
  score: WalletScore | null;
  classification: WalletClassification | null;
  metrics: {
    global: WalletMetrics | null;
    all_windows: WalletMetrics[];
  };
  category_metrics: CategoryMetrics[];
  open_positions: OpenPosition[];
  recent_positions: ClosedPosition[];
  dot_events: DotEvent[];
  computed_at: string;
}

// Bundle name mapping
const BUNDLE_NAMES: Record<string, string> = {
  'politics': 'Politics',
  'crypto': 'Crypto',
  'sports': 'Sports',
  'science': 'Science',
  'entertainment': 'Entertainment',
  'economics': 'Economics',
  'business': 'Business',
  'world': 'World News',
  'tech': 'Technology',
  'culture': 'Culture',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    const searchParams = request.nextUrl.searchParams;
    const requestedWindow = searchParams.get('window') || 'ALL';

    // Scores and classification tables currently only have '90d' data
    // Metrics table has all windows
    const scoreWindow = '90d';
    const metricsWindow = requestedWindow;

    // Run all queries in parallel for performance
    const [
      scoreResult,
      classificationResult,
      globalMetricsResult,
      allMetricsResult,
      categoryMetricsResult,
      openPositionsResult,
      recentPositionsResult,
      dotEventsResult,
    ] = await Promise.all([
      // 1. Wallet scores (only 90d available)
      clickhouse.query({
        query: `
          SELECT
            credibility_score,
            bot_likelihood,
            copyability_score,
            skill_component,
            consistency_component,
            sample_size_factor,
            fill_rate_signal,
            scalper_signal,
            horizon_component,
            risk_component,
            window_id
          FROM wio_wallet_scores_v1
          WHERE wallet_id = '${wallet}' AND window_id = '${scoreWindow}'
          LIMIT 1
        `,
        format: 'JSONEachRow',
      }),

      // 2. Classification/tier (only 90d available)
      clickhouse.query({
        query: `
          SELECT
            tier,
            roi_cost_weighted,
            win_rate,
            pnl_total_usd,
            resolved_positions_n,
            fills_per_day,
            credibility_score,
            bot_likelihood
          FROM wio_wallet_classification_v1
          WHERE wallet_id = '${wallet}' AND window_id = '${scoreWindow}'
          LIMIT 1
        `,
        format: 'JSONEachRow',
      }),

      // 3. Global metrics for requested window
      clickhouse.query({
        query: `
          SELECT *
          FROM wio_metric_observations_v1
          WHERE wallet_id = '${wallet}'
            AND scope_type = 'GLOBAL'
            AND window_id = '${metricsWindow}'
          LIMIT 1
        `,
        format: 'JSONEachRow',
      }),

      // 4. All metrics (all windows) for time comparisons
      clickhouse.query({
        query: `
          SELECT *
          FROM wio_metric_observations_v1
          WHERE wallet_id = '${wallet}'
            AND scope_type = 'GLOBAL'
          ORDER BY window_id
        `,
        format: 'JSONEachRow',
      }),

      // 5. Category metrics (BUNDLE scope)
      clickhouse.query({
        query: `
          SELECT
            scope_id,
            positions_n,
            resolved_positions_n,
            pnl_total_usd,
            roi_cost_weighted,
            win_rate,
            brier_mean
          FROM wio_metric_observations_v1
          WHERE wallet_id = '${wallet}'
            AND scope_type = 'BUNDLE'
            AND window_id = '${metricsWindow}'
            AND positions_n > 0
          ORDER BY positions_n DESC
        `,
        format: 'JSONEachRow',
      }),

      // 6. Open positions with market metadata
      clickhouse.query({
        query: `
          SELECT
            o.market_id,
            COALESCE(m.question, '') as question,
            COALESCE(m.category, '') as category,
            o.side,
            o.open_shares_net,
            o.open_cost_usd,
            o.avg_entry_price_side as avg_entry_price,
            o.mark_price_side as mark_price,
            o.unrealized_pnl_usd,
            o.unrealized_roi,
            o.bundle_id,
            toString(o.as_of_ts) as as_of_ts
          FROM wio_open_snapshots_v1 o
          LEFT JOIN pm_market_metadata m ON o.market_id = m.condition_id
          WHERE o.wallet_id = '${wallet}'
            AND o.open_shares_net > 0
          ORDER BY o.open_cost_usd DESC
          LIMIT 50
        `,
        format: 'JSONEachRow',
      }),

      // 7. Recent closed positions with market metadata
      clickhouse.query({
        query: `
          SELECT
            toString(p.position_id) as position_id,
            p.market_id,
            COALESCE(m.question, '') as question,
            COALESCE(m.category, p.category) as category,
            p.side,
            p.cost_usd,
            p.proceeds_usd,
            p.pnl_usd,
            p.roi,
            p.hold_minutes,
            p.brier_score,
            p.is_resolved,
            toString(p.ts_open) as ts_open,
            toString(p.ts_close) as ts_close,
            toString(p.ts_resolve) as ts_resolve
          FROM wio_positions_v2 p
          LEFT JOIN pm_market_metadata m ON p.condition_id = m.condition_id
          WHERE p.wallet_id = '${wallet}'
          ORDER BY p.ts_open DESC
          LIMIT 50
        `,
        format: 'JSONEachRow',
      }),

      // 8. Dot events (smart money signals from this wallet)
      clickhouse.query({
        query: `
          SELECT
            d.dot_id,
            toString(d.ts) as ts,
            d.market_id,
            COALESCE(m.question, '') as question,
            d.action,
            d.side,
            d.size_usd,
            d.dot_type,
            d.confidence,
            d.reason_metrics,
            d.entry_price,
            d.crowd_odds
          FROM wio_dot_events_v1 d
          LEFT JOIN pm_market_metadata m ON d.market_id = m.condition_id
          WHERE d.wallet_id = '${wallet}'
          ORDER BY d.ts DESC
          LIMIT 20
        `,
        format: 'JSONEachRow',
      }),
    ]);

    // Parse all results
    const scoreRows = (await scoreResult.json()) as WalletScore[];
    const classificationRows = (await classificationResult.json()) as WalletClassification[];
    const globalMetricsRows = (await globalMetricsResult.json()) as WalletMetrics[];
    const allMetricsRows = (await allMetricsResult.json()) as WalletMetrics[];
    const categoryMetricsRows = (await categoryMetricsResult.json()) as any[];
    const openPositionsRows = (await openPositionsResult.json()) as OpenPosition[];
    const recentPositionsRows = (await recentPositionsResult.json()) as ClosedPosition[];
    const dotEventsRows = (await dotEventsResult.json()) as DotEvent[];

    // Process category metrics with bundle names
    const categoryMetrics: CategoryMetrics[] = categoryMetricsRows.map((row) => ({
      scope_id: row.scope_id,
      bundle_name: BUNDLE_NAMES[row.scope_id] || row.scope_id,
      positions_n: row.positions_n,
      resolved_positions_n: row.resolved_positions_n,
      pnl_total_usd: row.pnl_total_usd,
      roi_cost_weighted: row.roi_cost_weighted,
      win_rate: row.win_rate,
      brier_mean: row.brier_mean,
    }));

    const profile: WalletProfile = {
      wallet_id: wallet,
      score: scoreRows[0] || null,
      classification: classificationRows[0] || null,
      metrics: {
        global: globalMetricsRows[0] || null,
        all_windows: allMetricsRows,
      },
      category_metrics: categoryMetrics,
      open_positions: openPositionsRows,
      recent_positions: recentPositionsRows,
      dot_events: dotEventsRows,
      computed_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      profile,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });

  } catch (error: any) {
    console.error('[wio/wallet] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
