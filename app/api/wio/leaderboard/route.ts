/**
 * API: WIO Leaderboard
 *
 * Returns top wallets by smart money score.
 *
 * Query params:
 * - limit: Number of wallets (default 50, max 500)
 * - tier: Filter by tier ('S', 'A', 'B', 'C')
 * - minPositions: Minimum positions count
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface LeaderboardEntry {
  wallet_id: string;
  rank: number;
  tier: string;
  composite_score: number;
  roi_percentile: number;
  brier_percentile: number;
  total_positions: number;
  total_pnl_usd: number;
  roi: number;
  win_rate: number;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit') || 50), 500);
    const tier = searchParams.get('tier');
    const minPositions = Number(searchParams.get('minPositions') || 0);

    const conditions: string[] = [];
    if (tier) {
      conditions.push(`s.tier = '${tier}'`);
    }
    if (minPositions > 0) {
      conditions.push(`m.total_positions >= ${minPositions}`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const query = `
      SELECT
        s.wallet_id,
        s.rank,
        s.tier,
        s.composite_score,
        s.roi_percentile,
        s.brier_percentile,
        m.total_positions,
        m.total_pnl_usd,
        m.roi,
        m.win_rate
      FROM wio_wallet_scores_v1 s
      LEFT JOIN wio_wallet_metrics_v1 m
        ON s.wallet_id = m.wallet_id
        AND m.scope = 'GLOBAL'
        AND m.time_window = 'ALL'
      ${whereClause}
      ORDER BY s.rank ASC
      LIMIT ${limit}
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const leaderboard = (await result.json()) as LeaderboardEntry[];

    // Get tier distribution
    const tierResult = await clickhouse.query({
      query: `
        SELECT tier, count() as count
        FROM wio_wallet_scores_v1
        GROUP BY tier
        ORDER BY tier
      `,
      format: 'JSONEachRow',
    });
    const tiers = (await tierResult.json()) as { tier: string; count: number }[];

    return NextResponse.json({
      success: true,
      count: leaderboard.length,
      tiers,
      leaderboard,
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
