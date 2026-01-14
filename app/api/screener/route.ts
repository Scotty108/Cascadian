/**
 * API: Market Screener from ClickHouse
 *
 * Fast, paginated market data for the main screener.
 * Uses pm_market_metadata for market data.
 *
 * GET /api/screener
 * Query params:
 *   - limit: number (default: 50, max: 100)
 *   - offset: number (default: 0)
 *   - category: string (optional)
 *   - sortBy: 'volume' | 'momentum' | 'liquidity' | 'price_change' (default: 'volume')
 *   - sortDir: 'asc' | 'desc' (default: 'desc')
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface ScreenerRow {
  market_id: string;
  title: string;
  category: string;
  outcome: string;
  last_price: number;
  price_delta: number;
  volume_24h: number;
  liquidity: number;
  end_date: string | null;
  best_bid: number;
  best_ask: number;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit') || 50), 100);
    const offset = Number(searchParams.get('offset') || 0);
    const category = searchParams.get('category');
    const sortBy = searchParams.get('sortBy') || 'volume';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Build WHERE conditions
    const conditions: string[] = [
      'is_active = 1',
      'is_closed = 0',
    ];

    if (category) {
      conditions.push(`category = '${category.replace(/'/g, "''")}'`);
    }

    const whereClause = conditions.join(' AND ');

    // Build ORDER BY
    let orderColumn = 'volume_24hr';
    switch (sortBy) {
      case 'momentum':
      case 'price_change':
        orderColumn = 'abs(price_change_1d)';
        break;
      case 'liquidity':
        orderColumn = 'liquidity_usdc';
        break;
      case 'volume':
      default:
        orderColumn = 'volume_24hr';
    }

    const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

    // Main query - fast single table scan
    const query = `
      SELECT
        condition_id as market_id,
        question as title,
        category,
        arrayElement(outcomes, 1) as outcome,
        toFloat64(JSONExtractFloat(outcome_prices, 1)) as last_price,
        price_change_1d as price_delta,
        volume_24hr as volume_24h,
        liquidity_usdc as liquidity,
        end_date,
        best_bid,
        best_ask
      FROM pm_market_metadata
      WHERE ${whereClause}
      ORDER BY ${orderColumn} ${orderDir}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Count query
    const countQuery = `
      SELECT count() as total
      FROM pm_market_metadata
      WHERE ${whereClause}
    `;

    // Run both queries in PARALLEL for speed
    const [mainResult, countResult] = await Promise.all([
      clickhouse.query({ query, format: 'JSONEachRow' }),
      clickhouse.query({ query: countQuery, format: 'JSONEachRow' }),
    ]);

    const [rows, countRows] = await Promise.all([
      mainResult.json() as Promise<ScreenerRow[]>,
      countResult.json() as Promise<{ total: number }[]>,
    ]);

    const total = countRows[0]?.total || 0;

    // Transform to screener format
    const markets = rows.map((row) => ({
      market_id: row.market_id,
      title: row.title,
      category: row.category || 'Other',
      outcome: row.outcome || 'Yes',
      last_price: row.last_price || 0.5,
      price_delta: row.price_delta || 0,
      volume_24h: row.volume_24h || 0,
      liquidity: row.liquidity || 0,
      end_date: row.end_date,
      // Momentum is price change * 100 for display
      momentum: (row.price_delta || 0) * 100,
      // Placeholder values - can be computed from WIO tables later
      trades_24h: 0,
      buyers_24h: 0,
      sellers_24h: 0,
      buy_sell_ratio: 1,
      whale_buy_sell_ratio: 1,
      whale_pressure: 0,
      smart_buy_sell_ratio: 1,
      smart_pressure: 0,
      sii: 0,
      volumeHistory: [],
    }));

    return NextResponse.json({
      success: true,
      markets,
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });

  } catch (error: any) {
    console.error('[screener] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      markets: [],
      total: 0,
    }, { status: 500 });
  }
}
