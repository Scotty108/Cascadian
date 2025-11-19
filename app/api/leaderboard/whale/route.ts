/**
 * Phase 2 Whale Leaderboard API
 *
 * Returns top 50 wallets ranked by lifetime realized P&L
 * Data source: default.whale_leaderboard (ClickHouse)
 *
 * Coverage: June 2024 → Present (trading markets only; rewards excluded)
 */

import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const ch = getClickHouseClient();

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 50);

    const query = `
      SELECT
        rank,
        wallet_address,
        realized_pnl,
        roi_pct,
        total_trades,
        markets_traded,
        win_rate
      FROM default.whale_leaderboard
      ORDER BY rank
      LIMIT ${limit}
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<any>();

    // Transform to frontend format
    const leaderboard = (rows || []).map((row: any) => ({
      rank: parseInt(row.rank),
      wallet_address: row.wallet_address,
      realized_pnl: parseFloat(row.realized_pnl),
      roi_pct: parseFloat(row.roi_pct),
      total_trades: parseInt(row.total_trades),
      markets_traded: parseInt(row.markets_traded),
      win_rate: parseFloat(row.win_rate),
    }));

    return NextResponse.json({
      success: true,
      data: leaderboard,
      count: leaderboard.length,
      metadata: {
        leaderboard_type: 'whale',
        primary_metric: 'realized_pnl',
        coverage: 'June 2024 → Present',
        disclaimer: 'Trading markets only; rewards excluded. Shows realized P&L from trading activity.',
        time_window: 'lifetime',
        max_entries: 50,
        note: 'Excludes some unrealized positions - see Polymarket for complete view',
      },
    });
  } catch (error) {
    console.error('Error in whale leaderboard API:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
