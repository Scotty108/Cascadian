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
  image_url: string | null;
}

interface ClosedPosition {
  position_id: string;
  market_id: string;
  question: string;
  category: string;
  side: string;
  shares: number;
  entry_price: number;
  exit_price: number;
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
  image_url: string | null;
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

interface Trade {
  event_id: string;
  side: string;
  amount_usd: number;
  shares: number;
  price: number;
  action: string;
  trade_time: string;
  token_id: string;
}

interface CategoryStats {
  category: string;
  positions: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_usd: number;
  avg_roi: number;
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

interface BubbleChartPosition {
  category: string;
  market_id: string;
  question: string;
  side: string;
  cost_usd: number;
  pnl_usd: number;
  roi: number;
  positions_count: number;
  image_url: string | null;
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
  category_stats: CategoryStats[];
  realized_pnl: number;
  open_positions_count: number;
  closed_positions_count: number;
  trades_count: number;
  open_positions: OpenPosition[];
  recent_positions: ClosedPosition[];
  recent_trades: Trade[];
  dot_events: DotEvent[];
  bubble_chart_data: BubbleChartPosition[];
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
      categoryStatsResult,
      realizedPnlResult,
      openPositionsCountResult,
      closedPositionsCountResult,
      tradesCountResult,
      openPositionsResult,
      recentPositionsResult,
      recentTradesResult,
      dotEventsResult,
      bubbleChartResult,
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
      // Use ORDER BY computed_at DESC to get latest row (ReplacingMergeTree may have duplicates)
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
          ORDER BY computed_at DESC
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

      // 6. Category stats from positions (for category breakdown)
      clickhouse.query({
        query: `
          SELECT
            category,
            count() as positions,
            sum(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as wins,
            sum(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) as losses,
            sum(pnl_usd) as total_pnl,
            avg(roi) as avg_roi
          FROM wio_positions_v2
          WHERE wallet_id = '${wallet}'
            AND is_resolved = 1
          GROUP BY category
          ORDER BY positions DESC
        `,
        format: 'JSONEachRow',
      }),

      // 7. Realized PnL (from closed positions)
      clickhouse.query({
        query: `
          SELECT
            sum(pnl_usd) as realized_pnl
          FROM wio_positions_v2
          WHERE wallet_id = '${wallet}'
            AND (is_resolved = 1 OR ts_close IS NOT NULL)
        `,
        format: 'JSONEachRow',
      }),

      // 7a. Open positions count
      clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM wio_open_snapshots_v1
          WHERE wallet_id = '${wallet}' AND open_shares_net > 0
        `,
        format: 'JSONEachRow',
      }),

      // 7b. Closed positions count
      clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM wio_positions_v2
          WHERE wallet_id = '${wallet}'
        `,
        format: 'JSONEachRow',
      }),

      // 7c. Trades count
      clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        `,
        format: 'JSONEachRow',
      }),

      // 8. Open positions with market metadata
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
            toString(o.as_of_ts) as as_of_ts,
            m.image_url
          FROM wio_open_snapshots_v1 o
          LEFT JOIN pm_market_metadata m ON o.market_id = m.condition_id
          WHERE o.wallet_id = '${wallet}'
            AND o.open_shares_net > 0
          ORDER BY o.open_cost_usd DESC
          LIMIT 100
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
            -- Shares: for LONG use qty_opened, for SHORT use qty_closed (the exposure)
            CASE
              WHEN p.qty_shares_opened > 0 THEN p.qty_shares_opened
              WHEN p.qty_shares_closed > 0 THEN p.qty_shares_closed
              ELSE greatest(p.cost_usd, p.proceeds_usd)
            END as shares,
            -- Entry price: for LONG cost/shares, for SHORT proceeds/shares_closed (what they received)
            CASE
              WHEN p.p_entry_side > 0 THEN p.p_entry_side
              WHEN p.qty_shares_opened > 0 THEN p.cost_usd / p.qty_shares_opened
              WHEN p.qty_shares_closed > 0 THEN p.proceeds_usd / p.qty_shares_closed
              ELSE 0
            END as entry_price,
            -- Exit price: for resolved positions use payout_rate, otherwise calculate from proceeds/shares
            CASE
              WHEN p.is_resolved = 1 THEN p.payout_rate
              WHEN p.qty_shares_closed > 0 THEN p.proceeds_usd / p.qty_shares_closed
              ELSE 0
            END as exit_price,
            p.cost_usd,
            p.proceeds_usd,
            p.pnl_usd,
            p.roi,
            p.hold_minutes,
            p.brier_score,
            p.is_resolved,
            toString(p.ts_open) as ts_open,
            toString(p.ts_close) as ts_close,
            toString(p.ts_resolve) as ts_resolve,
            m.image_url
          FROM wio_positions_v2 p
          LEFT JOIN pm_market_metadata m ON p.condition_id = m.condition_id
          WHERE p.wallet_id = '${wallet}'
          ORDER BY p.ts_open DESC
          LIMIT 100
        `,
        format: 'JSONEachRow',
      }),

      // 10. Recent trades with market metadata
      clickhouse.query({
        query: `
          SELECT
            t.event_id,
            t.side,
            t.usdc_amount / 1000000.0 as amount_usd,
            t.token_amount / 1000000.0 as shares,
            CASE WHEN t.token_amount > 0 THEN (t.usdc_amount / t.token_amount) ELSE 0 END as price,
            t.role as action,
            toString(t.trade_time) as trade_time,
            t.token_id,
            COALESCE(tm.question, '') as question,
            COALESCE(m.image_url, '') as image_url
          FROM pm_trader_events_v2 t
          LEFT JOIN pm_token_to_condition_map_current tm ON t.token_id = tm.token_id_dec
          LEFT JOIN pm_market_metadata m ON tm.condition_id = m.condition_id
          WHERE t.trader_wallet = '${wallet}'
            AND t.is_deleted = 0
          ORDER BY t.trade_time DESC
          LIMIT 100
        `,
        format: 'JSONEachRow',
      }),

      // 11. Dot events (smart money signals from this wallet)
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

      // 12. Bubble chart aggregated data (all positions grouped by market)
      clickhouse.query({
        query: `
          SELECT
            COALESCE(m.category, p.category, 'Other') as category,
            p.market_id,
            COALESCE(m.question, '') as question,
            p.side,
            sum(p.cost_usd) as cost_usd,
            sum(p.pnl_usd) as pnl_usd,
            CASE WHEN sum(p.cost_usd) > 0 THEN sum(p.pnl_usd) / sum(p.cost_usd) ELSE 0 END as roi,
            count() as positions_count,
            any(m.image_url) as image_url
          FROM wio_positions_v2 p
          LEFT JOIN pm_market_metadata m ON p.condition_id = m.condition_id
          WHERE p.wallet_id = '${wallet}'
            AND (p.is_resolved = 1 OR p.ts_close IS NOT NULL)
          GROUP BY
            COALESCE(m.category, p.category, 'Other'),
            p.market_id,
            COALESCE(m.question, ''),
            p.side
          ORDER BY cost_usd DESC
          LIMIT 500
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
    const categoryStatsRows = (await categoryStatsResult.json()) as any[];
    const realizedPnlRows = (await realizedPnlResult.json()) as { realized_pnl: number }[];
    const openPositionsCountRows = (await openPositionsCountResult.json()) as { cnt: string }[];
    const closedPositionsCountRows = (await closedPositionsCountResult.json()) as { cnt: string }[];
    const tradesCountRows = (await tradesCountResult.json()) as { cnt: string }[];
    const openPositionsRows = (await openPositionsResult.json()) as OpenPosition[];
    const recentPositionsRows = (await recentPositionsResult.json()) as ClosedPosition[];
    const recentTradesRows = (await recentTradesResult.json()) as Trade[];
    const dotEventsRows = (await dotEventsResult.json()) as DotEvent[];
    const bubbleChartRows = (await bubbleChartResult.json()) as BubbleChartPosition[];

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

    // Process category stats with win rate calculation
    const categoryStats: CategoryStats[] = categoryStatsRows.map((row) => ({
      category: row.category || 'Unknown',
      positions: row.positions,
      wins: row.wins,
      losses: row.losses,
      win_rate: row.positions > 0 ? row.wins / row.positions : 0,
      pnl_usd: row.total_pnl,
      avg_roi: row.avg_roi,
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
      category_stats: categoryStats,
      realized_pnl: realizedPnlRows[0]?.realized_pnl ?? 0,
      open_positions_count: parseInt(openPositionsCountRows[0]?.cnt || '0'),
      closed_positions_count: parseInt(closedPositionsCountRows[0]?.cnt || '0'),
      trades_count: parseInt(tradesCountRows[0]?.cnt || '0'),
      open_positions: openPositionsRows,
      recent_positions: recentPositionsRows,
      recent_trades: recentTradesRows,
      dot_events: dotEventsRows,
      bubble_chart_data: bubbleChartRows,
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
