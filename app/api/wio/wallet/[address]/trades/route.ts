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

    // First get basic trades
    const [tradesResult, countResult] = await Promise.all([
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
            COALESCE(m.image_url, '') as image_url
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
      clickhouse.query({
        query: `
          SELECT count() as total
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        `,
        format: 'JSONEachRow',
      }),
    ]);

    const rawTrades = (await tradesResult.json()) as Omit<Trade, 'roi' | 'avg_entry_price'>[];
    const countRows = (await countResult.json()) as { total: string }[];
    const totalCount = parseInt(countRows[0]?.total || '0');

    // Get sell trades that need ROI calculation
    const sellTrades = rawTrades.filter(t => t.side === 'sell');

    // Calculate ROI for sells by getting avg cost basis per token
    let costBasisMap: Record<string, { avgCost: number }> = {};

    if (sellTrades.length > 0) {
      const tokenIds = [...new Set(sellTrades.map(t => t.token_id))];
      const costBasisResult = await clickhouse.query({
        query: `
          SELECT
            token_id,
            sum(usdc_amount) / sum(token_amount) as avg_cost
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}'
            AND is_deleted = 0
            AND side = 'buy'
            AND token_id IN (${tokenIds.map(id => `'${id}'`).join(',')})
          GROUP BY token_id
          HAVING sum(token_amount) > 0
        `,
        format: 'JSONEachRow',
      });
      const costBasisRows = (await costBasisResult.json()) as { token_id: string; avg_cost: number }[];
      costBasisMap = Object.fromEntries(
        costBasisRows.map(r => [r.token_id, { avgCost: r.avg_cost }])
      );
    }

    // Add ROI to trades
    const trades: Trade[] = rawTrades.map(t => {
      if (t.side === 'sell' && costBasisMap[t.token_id]) {
        const avgEntry = costBasisMap[t.token_id].avgCost;
        const roi = (t.price - avgEntry) / avgEntry;
        return { ...t, roi, avg_entry_price: avgEntry };
      }
      return { ...t, roi: null, avg_entry_price: null };
    });

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
