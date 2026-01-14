/**
 * API: WIO Unified Leaderboard
 *
 * Returns top wallets ranked by credibility score with full WIO metrics.
 *
 * Query params:
 * - limit: Number of wallets (default 100, max 500)
 * - tier: Filter by tier ('superforecaster', 'smart', 'profitable', etc.)
 * - minPositions: Minimum resolved positions count (default 10)
 * - minPnl: Minimum total PnL in USD (default 0)
 * - sortBy: Sort field ('credibility', 'pnl', 'roi', 'win_rate') - default 'credibility'
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
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
    const tier = searchParams.get('tier');
    const minPositions = Number(searchParams.get('minPositions') || 10);
    const minPnl = Number(searchParams.get('minPnl') || 0);
    const sortBy = searchParams.get('sortBy') || 'credibility';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Build outer WHERE conditions (applied after deduplication)
    const outerConditions: string[] = [
      `resolved_positions_n >= ${minPositions}`,
    ];

    // Add minimum PnL filter if specified
    if (minPnl > 0) {
      outerConditions.push(`pnl_total_usd >= ${minPnl}`);
    }

    if (tier) {
      outerConditions.push(`tier = '${tier}'`);
    } else {
      // By default, exclude inactive and heavy losers
      outerConditions.push(`tier NOT IN ('inactive', 'heavy_loser')`);
    }

    const outerWhereClause = `WHERE ${outerConditions.join(' AND ')}`;

    const sortField = SORT_FIELD_MAP[sortBy] || 'credibility_score';
    const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

    // Main leaderboard query
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
        m.fills_per_day
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
        ${minPnl > 0 ? `AND m.pnl_total_usd >= ${minPnl}` : ''}
        ${tier ? `AND c.tier = '${tier}'` : `AND coalesce(c.tier, 'profitable') NOT IN ('inactive', 'heavy_loser')`}
      ORDER BY ${sortField} ${sortDirection}
      LIMIT ${limit}
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

    // Run BOTH queries in parallel for speed
    const [mainResult, tierStatsResult] = await Promise.all([
      clickhouse.query({ query, format: 'JSONEachRow' }),
      clickhouse.query({ query: tierStatsQuery, format: 'JSONEachRow' }),
    ]);

    const [rawLeaderboard, tierStats] = await Promise.all([
      mainResult.json() as Promise<any[]>,
      tierStatsResult.json() as Promise<TierStats[]>,
    ]);

    // Add rank numbers
    const leaderboard: LeaderboardEntry[] = rawLeaderboard.map((entry, index) => ({
      rank: index + 1,
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
