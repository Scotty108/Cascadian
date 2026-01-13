/**
 * API: Get WIO Wallet Profile
 *
 * Returns metrics, scores, and recent positions for a wallet.
 *
 * Path: /api/wio/wallet/[address]
 * Query params:
 * - scope: Filter metrics by scope (default 'GLOBAL')
 * - window: Filter metrics by time window (default 'ALL')
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface WalletProfile {
  wallet_id: string;
  score: {
    composite_score: number;
    tier: string;
    rank: number;
    roi_percentile: number;
    brier_percentile: number;
  } | null;
  metrics: {
    scope: string;
    time_window: string;
    total_positions: number;
    total_cost_usd: number;
    total_pnl_usd: number;
    roi: number;
    win_rate: number;
    avg_brier_score: number | null;
    resolved_positions: number;
  }[];
  recent_positions: {
    market_id: string;
    side: string;
    cost_usd: number;
    pnl_usd: number;
    ts_open: string;
    is_resolved: number;
  }[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    const searchParams = request.nextUrl.searchParams;
    const scope = searchParams.get('scope') || 'GLOBAL';
    const window = searchParams.get('window') || 'ALL';

    // Get wallet score
    const scoreResult = await clickhouse.query({
      query: `
        SELECT
          composite_score,
          tier,
          rank,
          roi_percentile,
          brier_percentile
        FROM wio_wallet_scores_v1
        WHERE wallet_id = '${wallet}'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const scoreRows = (await scoreResult.json()) as any[];
    const score = scoreRows[0] || null;

    // Get wallet metrics (all scopes/windows)
    const metricsResult = await clickhouse.query({
      query: `
        SELECT
          scope,
          time_window,
          total_positions,
          total_cost_usd,
          total_pnl_usd,
          roi,
          win_rate,
          avg_brier_score,
          resolved_positions
        FROM wio_wallet_metrics_v1
        WHERE wallet_id = '${wallet}'
        ORDER BY scope, time_window
      `,
      format: 'JSONEachRow',
    });
    const metrics = (await metricsResult.json()) as any[];

    // Get recent positions
    const positionsResult = await clickhouse.query({
      query: `
        SELECT
          market_id,
          side,
          cost_usd,
          pnl_usd,
          toString(ts_open) as ts_open,
          is_resolved
        FROM wio_positions_v1
        WHERE wallet_id = '${wallet}'
        ORDER BY ts_open DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    });
    const recent_positions = (await positionsResult.json()) as any[];

    const profile: WalletProfile = {
      wallet_id: wallet,
      score,
      metrics,
      recent_positions,
    };

    return NextResponse.json({
      success: true,
      profile,
    });

  } catch (error: any) {
    console.error('[wio/wallet] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
