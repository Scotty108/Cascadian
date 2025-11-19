/**
 * Phase 2 Omega Leaderboard API
 *
 * Returns top 50 wallets ranked by omega ratio (min 10 trades)
 * Data source: default.omega_leaderboard (ClickHouse)
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
        omega_ratio,
        sharpe_ratio,
        total_trades,
        win_rate,
        realized_pnl
      FROM default.omega_leaderboard
      ORDER BY rank
      LIMIT ${limit}
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<any>();

    // Transform to frontend format
    const leaderboard = (rows || []).map((row: any) => ({
      rank: parseInt(row.rank),
      wallet_address: row.wallet_address,
      omega_ratio: parseFloat(row.omega_ratio),
      sharpe_ratio: parseFloat(row.sharpe_ratio),
      total_trades: parseInt(row.total_trades),
      win_rate: parseFloat(row.win_rate),
      realized_pnl: parseFloat(row.realized_pnl),
    }));

    return NextResponse.json({
      success: true,
      data: leaderboard,
      count: leaderboard.length,
      metadata: {
        leaderboard_type: 'omega',
        primary_metric: 'omega_ratio',
        coverage: 'June 2024 → Present',
        disclaimer: 'Trading markets only; rewards excluded. Shows realized P&L from trading activity.',
        time_window: 'lifetime',
        min_trades: 10,
        max_entries: 50,
        note: 'Filtered for statistical significance (minimum 10 trades). Excludes some unrealized positions.',
      },
    });
  } catch (error) {
    console.error('Error in omega leaderboard API:', error);
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
