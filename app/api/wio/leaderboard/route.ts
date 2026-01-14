/**
 * API: WIO Unified Leaderboard
 *
 * Returns top wallets ranked by credibility score with full WIO metrics.
 *
 * Query params:
 * - limit: Number of wallets (default 100, max 500)
 * - tier: Filter by tier ('superforecaster', 'smart', 'profitable', etc.)
 * - minPositions: Minimum resolved positions count (default 10)
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
    const sortBy = searchParams.get('sortBy') || 'credibility';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Build conditions
    const conditions: string[] = [
      `window_id = '90d'`,
      `resolved_positions_n >= ${minPositions}`,
    ];

    if (tier) {
      conditions.push(`tier = '${tier}'`);
    } else {
      // By default, exclude inactive and heavy losers
      conditions.push(`tier NOT IN ('inactive', 'heavy_loser')`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const sortField = SORT_FIELD_MAP[sortBy] || 'c.credibility_score';
    const sortDirection = sortDir === 'asc' ? 'ASC' : 'DESC';

    // Main leaderboard query - simplified to avoid expensive JOINs
    const query = `
      SELECT
        wallet_id,
        tier,
        credibility_score,
        bot_likelihood,
        pnl_total_usd,
        roi_cost_weighted,
        win_rate,
        resolved_positions_n,
        fills_per_day
      FROM wio_wallet_classification_v1
      ${whereClause}
      ORDER BY ${sortField} ${sortDirection}
      LIMIT ${limit}
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const rawLeaderboard = (await result.json()) as any[];

    // Add rank numbers
    const leaderboard: LeaderboardEntry[] = rawLeaderboard.map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

    // Get tier distribution with stats
    const tierStatsQuery = `
      SELECT
        tier,
        count() as count,
        sum(pnl_total_usd) as total_pnl,
        avg(roi_cost_weighted) as avg_roi,
        avg(win_rate) as avg_win_rate
      FROM wio_wallet_classification_v1
      WHERE window_id = '90d'
        AND resolved_positions_n >= ${minPositions}
        AND tier NOT IN ('inactive')
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

    const tierStatsResult = await clickhouse.query({
      query: tierStatsQuery,
      format: 'JSONEachRow',
    });
    const tierStats = (await tierStatsResult.json()) as TierStats[];

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
