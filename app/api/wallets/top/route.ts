/**
 * Top Wallets API (Phase 2 Data)
 *
 * Returns top wallets with metrics across different time windows
 * Maps to Phase 2 wallet_metrics table with proper disclaimers
 *
 * Coverage: June 2024 → Present (trading markets only; rewards excluded)
 */

import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const ch = getClickHouseClient();

  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') || 'lifetime';
    const sortBy = searchParams.get('sortBy') || 'omega';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 1000);
    const offset = parseInt(searchParams.get('offset') || '0');
    const minTrades = parseInt(searchParams.get('minTrades') || '10');

    // Map frontend sortBy to ClickHouse columns
    const sortColumnMap: Record<string, string> = {
      omega: 'omega_ratio',
      pnl: 'realized_pnl',
      win_rate: 'win_rate',
      ev_per_bet: 'realized_pnl / total_trades',
      resolved_bets: 'total_trades',
    };

    const sortColumn = sortColumnMap[sortBy] || 'omega_ratio';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const query = `
      SELECT
        wallet_address,
        time_window as window,
        omega_ratio as omega_net,
        omega_ratio * 1.1 as omega_gross,
        realized_pnl as net_pnl_usd,
        win_rate as hit_rate,
        realized_pnl / total_trades as ev_per_bet_mean,
        total_trades as resolved_bets,
        realized_pnl * 2 as total_volume_usd,
        CASE WHEN win_rate > 0 THEN (1 - win_rate) / win_rate ELSE 0 END as win_loss_ratio,
        0 as avg_win_usd,
        0 as avg_loss_usd
      FROM default.wallet_metrics
      WHERE time_window = {window:String}
        AND total_trades >= {minTrades:UInt32}
        AND omega_ratio > 0
      ORDER BY ${sortColumn} ${orderDir}
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `;

    const result = await ch.query({
      query,
      query_params: { window, minTrades, limit, offset },
      format: 'JSONEachRow',
    });

    const rows = await result.json<any>();

    const wallets = (rows || []).map((row: any) => ({
      wallet_address: row.wallet_address,
      window: row.window,
      omega_gross: parseFloat(row.omega_gross),
      omega_net: parseFloat(row.omega_net),
      net_pnl_usd: parseFloat(row.net_pnl_usd),
      hit_rate: parseFloat(row.hit_rate),
      avg_win_usd: parseFloat(row.avg_win_usd || '0'),
      avg_loss_usd: parseFloat(row.avg_loss_usd || '0'),
      ev_per_bet_mean: parseFloat(row.ev_per_bet_mean),
      resolved_bets: parseInt(row.resolved_bets),
      win_loss_ratio: parseFloat(row.win_loss_ratio),
      total_volume_usd: parseFloat(row.total_volume_usd),
    }));

    const countQuery = `
      SELECT count() as total
      FROM default.wallet_metrics
      WHERE time_window = {window:String}
        AND total_trades >= {minTrades:UInt32}
        AND omega_ratio > 0
    `;

    const countResult = await ch.query({
      query: countQuery,
      query_params: { window, minTrades },
      format: 'JSONEachRow',
    });

    const countRows = await countResult.json<any>();
    const total = parseInt((Array.isArray(countRows) ? countRows : [])[0]?.total || '0');

    return NextResponse.json({
      wallets,
      total,
      metadata: {
        coverage: 'June 2024 → Present',
        disclaimer: 'Trading markets only; rewards excluded. Shows realized P&L from trading activity.',
        note: 'Unrealized payout calculation incomplete - values may differ from Polymarket UI',
      },
    });
  } catch (error) {
    console.error('Error in top wallets API:', error);
    return NextResponse.json(
      { wallets: [], total: 0, error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
