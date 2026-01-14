/**
 * API: WIO Unified Leaderboard
 *
 * Returns top wallets ranked by credibility score with full WIO metrics.
 *
 * Query params:
 * - page: Page number (default 1)
 * - pageSize: Items per page (default 20, max 100)
 * - tier: Filter by tier ('superforecaster', 'smart', 'profitable', etc.)
 * - minPositions: Minimum resolved positions count (default 10)
 * - minPnl: Minimum total PnL in USD (default 0)
 * - minWinRate: Minimum win rate (0-1, e.g., 0.5 for 50%)
 * - minROI: Minimum ROI (e.g., 0.1 for 10%)
 * - maxDaysSinceLastTrade: Maximum days since last trade (for activity filter)
 * - sortBy: Sort field ('credibility', 'pnl', 'roi', 'win_rate', 'positions', 'activity') - default 'credibility'
 * - sortDir: Sort direction ('asc', 'desc') - default 'desc'
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface LeaderboardEntry {
  rank: number;
  wallet_id: string;
  tier: string;
  credibility_score: number;
  bot_likelihood: number;
  pnl_total_usd: number;
  roi_cost_weighted: number;
  win_rate: number;
  resolved_positions_n: number;
  fills_per_day: number;
  days_since_last_trade: number | null;
  profit_factor: number;
  active_days_n: number;
}

interface TierStats {
  tier: string;
  count: number;
  total_pnl: number;
  avg_roi: number;
  avg_win_rate: number;
}

const SORT_FIELD_MAP: Record<string, string> = {
  credibility: 'credibility_score',
  pnl: 'pnl_total_usd',
  roi: 'roi_cost_weighted',
  win_rate: 'win_rate',
  positions: 'resolved_positions_n',
  activity: 'days_since_last_trade',
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get('pageSize') || 20)), 100);
    const tier = searchParams.get('tier');
    const minPositions = Number(searchParams.get('minPositions') || 10);
    const minPnl = Number(searchParams.get('minPnl') || 0);
    const minWinRate = searchParams.get('minWinRate') ? Number(searchParams.get('minWinRate')) : null;
    const minROI = searchParams.get('minROI') ? Number(searchParams.get('minROI')) : null;
    const maxDaysSinceLastTrade = searchParams.get('maxDaysSinceLastTrade') ? Number(searchParams.get('maxDaysSinceLastTrade')) : null;
    const sortBy = searchParams.get('sortBy') || 'credibility';
    const sortDir = searchParams.get('sortDir') || 'desc';

    const offset = (page - 1) * pageSize;

    const sortField = SORT_FIELD_MAP[sortBy] || 'credibility_score';
    const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clause for filtering
    const tierCondition = tier
      ? `AND c.tier = '${tier}'`
      : `AND coalesce(c.tier, 'profitable') NOT IN ('inactive', 'heavy_loser')`;

    // Activity filter condition (computed from positions)
    const activityJoin = maxDaysSinceLastTrade !== null
      ? `JOIN (
          SELECT wallet_id, dateDiff('day', max(ts_open), now()) as days_since_last_trade
          FROM wio_positions_v2
          GROUP BY wallet_id
          HAVING days_since_last_trade <= ${maxDaysSinceLastTrade}
        ) activity ON s.wallet_id = activity.wallet_id`
      : `LEFT JOIN (
          SELECT wallet_id, dateDiff('day', max(ts_open), now()) as days_since_last_trade
          FROM wio_positions_v2
          GROUP BY wallet_id
        ) activity ON s.wallet_id = activity.wallet_id`;

    // Main leaderboard query with pagination
    // IMPORTANT: Use wio_wallet_scores_v1 for credibility (correct formula)
    // Use wio_wallet_classification_v1 only for tier
    // Use wio_metric_observations_v1 for actual metrics
    const query = `
      SELECT
        s.wallet_id as wallet_id,
        coalesce(c.tier, 'profitable') as tier,
        s.credibility_score,
        s.bot_likelihood,
        m.pnl_total_usd,
        m.roi_cost_weighted,
        m.win_rate,
        m.resolved_positions_n,
        m.fills_per_day,
        activity.days_since_last_trade as days_since_last_trade,
        m.profit_factor,
        m.active_days_n
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 m
        ON s.wallet_id = m.wallet_id
        AND m.scope_type = 'GLOBAL'
        AND m.window_id = '90d'
      LEFT JOIN (
        SELECT wallet_id, argMax(tier, computed_at) as tier
        FROM wio_wallet_classification_v1
        WHERE window_id = '90d'
        GROUP BY wallet_id
      ) c ON s.wallet_id = c.wallet_id
      ${activityJoin}
      WHERE s.window_id = '90d'
        AND m.resolved_positions_n >= ${minPositions}
        ${minPnl > 0 ? `AND m.pnl_total_usd >= ${minPnl}` : ''}
        ${minWinRate !== null ? `AND m.win_rate >= ${minWinRate}` : ''}
        ${minROI !== null ? `AND m.roi_cost_weighted >= ${minROI}` : ''}
        ${tierCondition}
      ORDER BY ${sortField === 'days_since_last_trade' ? 'activity.days_since_last_trade' : sortField} ${sortDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    // Count query to get total matching records
    const countQuery = `
      SELECT count() as total
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 m
        ON s.wallet_id = m.wallet_id
        AND m.scope_type = 'GLOBAL'
        AND m.window_id = '90d'
      LEFT JOIN (
        SELECT wallet_id, argMax(tier, computed_at) as tier
        FROM wio_wallet_classification_v1
        WHERE window_id = '90d'
        GROUP BY wallet_id
      ) c ON s.wallet_id = c.wallet_id
      ${activityJoin}
      WHERE s.window_id = '90d'
        AND m.resolved_positions_n >= ${minPositions}
        ${minPnl > 0 ? `AND m.pnl_total_usd >= ${minPnl}` : ''}
        ${minWinRate !== null ? `AND m.win_rate >= ${minWinRate}` : ''}
        ${minROI !== null ? `AND m.roi_cost_weighted >= ${minROI}` : ''}
        ${tierCondition}
    `;

    // Get tier distribution with stats - using scores + metrics tables
    const tierStatsQuery = `
      SELECT
        coalesce(c.tier, 'profitable') as tier,
        count() as count,
        sum(m.pnl_total_usd) as total_pnl,
        avg(m.roi_cost_weighted) as avg_roi,
        avg(m.win_rate) as avg_win_rate
      FROM wio_wallet_scores_v1 s
      JOIN wio_metric_observations_v1 m
        ON s.wallet_id = m.wallet_id
        AND m.scope_type = 'GLOBAL'
        AND m.window_id = '90d'
      LEFT JOIN (
        SELECT wallet_id, argMax(tier, computed_at) as tier
        FROM wio_wallet_classification_v1
        WHERE window_id = '90d'
        GROUP BY wallet_id
      ) c ON s.wallet_id = c.wallet_id
      WHERE s.window_id = '90d'
        AND m.resolved_positions_n >= ${minPositions}
        AND coalesce(c.tier, 'profitable') NOT IN ('inactive')
      GROUP BY tier
      ORDER BY
        CASE tier
          WHEN 'superforecaster' THEN 1
          WHEN 'smart' THEN 2
          WHEN 'profitable' THEN 3
          WHEN 'slight_loser' THEN 4
          WHEN 'heavy_loser' THEN 5
          WHEN 'bot' THEN 6
          ELSE 7
        END
    `;

    // Run all queries in parallel for speed
    const [mainResult, countResult, tierStatsResult] = await Promise.all([
      clickhouse.query({ query, format: 'JSONEachRow' }),
      clickhouse.query({ query: countQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: tierStatsQuery, format: 'JSONEachRow' }),
    ]);

    const [rawLeaderboard, countData, tierStats] = await Promise.all([
      mainResult.json() as Promise<any[]>,
      countResult.json() as Promise<Array<{ total: number }>>,
      tierStatsResult.json() as Promise<TierStats[]>,
    ]);

    const totalCount = countData[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Add rank numbers (accounting for offset)
    const leaderboard: LeaderboardEntry[] = rawLeaderboard.map((entry, index) => ({
      rank: offset + index + 1,
      ...entry,
    }));

    // Calculate summary stats
    const totalWallets = tierStats.reduce((sum, t) => sum + t.count, 0);
    const superforecasterCount = tierStats.find(t => t.tier === 'superforecaster')?.count || 0;
    const smartCount = tierStats.find(t => t.tier === 'smart')?.count || 0;
    const profitableCount = tierStats.find(t => t.tier === 'profitable')?.count || 0;

    return NextResponse.json({
      success: true,
      count: leaderboard.length,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
      summary: {
        total_qualified_wallets: totalWallets,
        superforecasters: superforecasterCount,
        smart_money: smartCount,
        profitable: profitableCount,
        min_positions_filter: minPositions,
      },
      tier_stats: tierStats,
      leaderboard,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });

  } catch (error: any) {
    console.error('[wio/leaderboard] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      leaderboard: [],
    }, { status: 500 });
  }
}
