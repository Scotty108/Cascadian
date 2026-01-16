/**
 * API: Get Position Trades
 *
 * Returns all trades for a market (both YES and NO outcomes) grouped by tx_hash with FIFO cost basis breakdown.
 * Each tx_hash represents one user action/decision.
 * Called on-demand when user expands a position row.
 *
 * Path: /api/wio/wallet/[address]/position-trades
 * Query params:
 * - condition_id: The condition/market ID
 * - outcome_index: (optional) The position's outcome - used for context but we fetch both
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { computeFifoBreakdownByOutcome, TradeWithFifo } from '@/lib/pnl/fifoBreakdown';

export const runtime = 'nodejs';

interface RawTradeWithOutcome {
  tx_hash: string;
  side: string;
  usdc_amount: number;
  shares: number;
  price: number;
  action: string;
  trade_time: string;
  outcome_index: number;
  fill_count: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    const searchParams = request.nextUrl.searchParams;
    const conditionId = searchParams.get('condition_id');

    if (!conditionId) {
      return NextResponse.json({
        success: false,
        error: 'condition_id is required',
      }, { status: 400 });
    }

    // Query ALL trades for this market grouped by tx_hash (each tx = one user action)
    // This gives complete picture of activity for this condition
    const result = await clickhouse.query({
      query: `
        SELECT
          t.transaction_hash as tx_hash,
          any(t.side) as side,
          sum(t.usdc_amount) / 1000000.0 as usdc_amount,
          sum(t.token_amount) / 1000000.0 as shares,
          CASE WHEN sum(t.token_amount) > 0 THEN sum(t.usdc_amount) / sum(t.token_amount) ELSE 0 END as price,
          any(t.role) as action,
          toString(min(t.trade_time)) as trade_time,
          any(m.outcome_index) as outcome_index,
          count() as fill_count
        FROM pm_trader_events_v2 t
        INNER JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE t.trader_wallet = '${wallet}'
          AND m.condition_id = '${conditionId}'
          AND t.is_deleted = 0
        GROUP BY t.transaction_hash
        ORDER BY min(t.trade_time) ASC
        LIMIT 200
      `,
      format: 'JSONEachRow',
    });

    const rawTrades = (await result.json()) as RawTradeWithOutcome[];

    // Apply FIFO breakdown logic separately for each outcome
    const tradesWithFifo = computeFifoBreakdownByOutcome(rawTrades);

    return NextResponse.json({
      success: true,
      trades: tradesWithFifo,
      trade_count: tradesWithFifo.length,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });

  } catch (error: any) {
    console.error('[wio/wallet/position-trades] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
