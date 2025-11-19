/**
 * Phase 2 Wallet Metrics API
 *
 * Returns metrics for a specific wallet across all time windows
 * Data source: default.wallet_metrics (ClickHouse)
 *
 * Coverage: June 2024 → Present (trading markets only; rewards excluded)
 */

import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const ch = getClickHouseClient();

  try {
    const { address } = await params;
    const walletAddress = address.toLowerCase();

    const query = `
      SELECT
        wallet_address,
        time_window,
        realized_pnl,
        unrealized_payout,
        realized_pnl + unrealized_payout as total_pnl,
        roi_pct,
        win_rate,
        sharpe_ratio,
        omega_ratio,
        total_trades,
        markets_traded,
        calculated_at
      FROM default.wallet_metrics
      WHERE wallet_address = {address:String}
      ORDER BY
        CASE time_window
          WHEN '30d' THEN 1
          WHEN '90d' THEN 2
          WHEN '180d' THEN 3
          WHEN 'lifetime' THEN 4
        END
    `;

    const result = await ch.query({
      query,
      query_params: { address: walletAddress },
      format: 'JSONEachRow',
    });

    const rows = await result.json<any[]>();

    if (rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Wallet not found',
        note: 'This wallet has no trading activity in the June 2024 → Present coverage period',
      }, { status: 404 });
    }

    // Transform to frontend format
    const metrics: Record<string, any> = {};
    rows.forEach(row => {
      metrics[row.time_window] = {
        realized_pnl: parseFloat(row.realized_pnl),
        unrealized_payout: parseFloat(row.unrealized_payout),
        total_pnl: parseFloat(row.total_pnl),
        roi_pct: parseFloat(row.roi_pct),
        win_rate: parseFloat(row.win_rate),
        sharpe_ratio: parseFloat(row.sharpe_ratio),
        omega_ratio: parseFloat(row.omega_ratio),
        total_trades: parseInt(row.total_trades),
        markets_traded: parseInt(row.markets_traded),
        calculated_at: row.calculated_at,
      };
    });

    return NextResponse.json({
      success: true,
      wallet_address: walletAddress,
      metrics,
      metadata: {
        coverage: 'June 2024 → Present',
        disclaimer: 'Trading markets only; rewards excluded. Shows realized P&L from trading activity.',
        time_windows: ['30d', '90d', '180d', 'lifetime'],
        note: 'Unrealized payout calculation incomplete - values may differ from Polymarket UI',
      },
    });
  } catch (error) {
    console.error('Error in wallet metrics API:', error);
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
