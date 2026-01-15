/**
 * API: Get Wallet Trades (Lazy Load)
 *
 * Returns recent trades for a wallet.
 * Called on-demand when user opens the Trades tab.
 *
 * Path: /api/wio/wallet/[address]/trades
 * Query params:
 * - page: Page number (default 1)
 * - pageSize: Items per page (default 50, max 100)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface Trade {
  event_id: string;
  side: string;
  amount_usd: number;
  shares: number;
  price: number;
  action: string;
  trade_time: string;
  token_id: string;
  question: string;
  image_url: string;
  roi: number | null; // ROI for sell trades (null for buys)
  avg_entry_price: number | null; // Average cost basis for sell trades
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get('pageSize') || 50)), 100);
    const offset = (page - 1) * pageSize;

    // Run queries in parallel
    const [tradesResult, countResult] = await Promise.all([
      // Recent trades with market metadata (simplified query for reliability)
      clickhouse.query({
        query: `
          SELECT
            t.event_id as event_id,
            t.side as side,
            t.usdc_amount / 1000000.0 as amount_usd,
            t.token_amount / 1000000.0 as shares,
            CASE WHEN t.token_amount > 0 THEN (t.usdc_amount / t.token_amount) ELSE 0 END as price,
            t.role as action,
            toString(t.trade_time) as trade_time,
            t.token_id as token_id,
            COALESCE(tm.question, '') as question,
            COALESCE(m.image_url, '') as image_url,
            NULL as roi,
            NULL as avg_entry_price
          FROM pm_trader_events_v2 t
          LEFT JOIN pm_token_to_condition_map_current tm ON t.token_id = tm.token_id_dec
          LEFT JOIN pm_market_metadata m ON tm.condition_id = m.condition_id
          WHERE t.trader_wallet = '${wallet}'
            AND t.is_deleted = 0
          ORDER BY t.trade_time DESC
          LIMIT ${pageSize}
          OFFSET ${offset}
        `,
        format: 'JSONEachRow',
      }),

      // Count total trades
      clickhouse.query({
        query: `
          SELECT count() as total
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        `,
        format: 'JSONEachRow',
      }),
    ]);

    const trades = (await tradesResult.json()) as Trade[];
    const countRows = (await countResult.json()) as { total: string }[];
    const totalCount = parseInt(countRows[0]?.total || '0');

    return NextResponse.json({
      success: true,
      trades,
      count: trades.length,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[wio/wallet/trades] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
