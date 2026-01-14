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

// Stock ticker symbols that are miscategorized as "Sports" in the database
const STOCK_TICKER_PATTERNS = [
  /\b(NFLX|AAPL|GOOGL|GOOG|MSFT|AMZN|META|NVDA|TSLA|AMD|INTC|COIN|SPY|QQQ|BTC|ETH)\b/i,
];

// Correct miscategorized markets (e.g., stock tickers labeled as "Sports")
function correctCategory(category: string, question: string): string {
  const isStockMarket = STOCK_TICKER_PATTERNS.some(pattern => pattern.test(question));
  const isUpDownMarket = /up.or.down/i.test(question);

  if (isStockMarket || isUpDownMarket) {
    return 'Finance';
  }
  return category || 'Other';
}

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
  // Smart money data from WIO
  smart_money_odds: number | null;
  crowd_odds: number | null;
  smart_vs_crowd_delta: number | null;
  smart_wallet_count: number | null;
  smart_holdings_usd: number | null;
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
    let useSmartMoneySort = false;
    switch (sortBy) {
      case 'momentum':
      case 'price_change':
        orderColumn = 'abs(price_change_1d)';
        break;
      case 'liquidity':
        orderColumn = 'liquidity_usdc';
        break;
      case 'smart_divergence':
        orderColumn = 'abs(w.smart_vs_crowd_delta)';
        useSmartMoneySort = true;
        break;
      case 'smart_wallets':
        orderColumn = 'w.smart_wallet_count';
        useSmartMoneySort = true;
        break;
      case 'volume':
      default:
        orderColumn = 'volume_24hr';
    }

    const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

    // Main query - join with WIO market snapshots for smart money data
    const query = `
      SELECT
        m.condition_id as market_id,
        m.question as title,
        m.category,
        arrayElement(m.outcomes, 1) as outcome,
        toFloat64(JSONExtractFloat(m.outcome_prices, 1)) as last_price,
        m.price_change_1d as price_delta,
        m.volume_24hr as volume_24h,
        m.liquidity_usdc as liquidity,
        m.end_date,
        m.best_bid,
        m.best_ask,
        -- Smart money data from latest snapshot
        w.smart_money_odds,
        w.crowd_odds,
        w.smart_vs_crowd_delta,
        w.smart_wallet_count,
        w.smart_holdings_usd
      FROM pm_market_metadata m
      LEFT JOIN (
        SELECT market_id, smart_money_odds, crowd_odds, smart_vs_crowd_delta,
               smart_wallet_count, smart_holdings_usd
        FROM wio_market_snapshots_v1
        WHERE (market_id, as_of_ts) IN (
          SELECT market_id, max(as_of_ts)
          FROM wio_market_snapshots_v1
          GROUP BY market_id
        )
      ) w ON m.condition_id = w.market_id
      WHERE ${whereClause.replace(/(\w+)\s*=/g, 'm.$1 =')}
      ORDER BY ${useSmartMoneySort ? orderColumn : `m.${orderColumn}`} ${orderDir} NULLS LAST
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Count query
    const countQuery = `
      SELECT count() as total
      FROM pm_market_metadata m
      WHERE ${whereClause.replace(/(\w+)\s*=/g, 'm.$1 =')}
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
      category: correctCategory(row.category, row.title || ''),
      outcome: row.outcome || 'Yes',
      last_price: row.last_price || 0.5,
      price_delta: row.price_delta || 0,
      volume_24h: row.volume_24h || 0,
      liquidity: row.liquidity || 0,
      end_date: row.end_date,
      // Momentum is price change * 100 for display
      momentum: (row.price_delta || 0) * 100,
      // Smart money data from WIO
      smart_money_odds: row.smart_money_odds ?? null,
      crowd_odds: row.crowd_odds ?? null,
      smart_vs_crowd_delta: row.smart_vs_crowd_delta ?? null,
      smart_wallet_count: row.smart_wallet_count ?? null,
      smart_holdings_usd: row.smart_holdings_usd ?? null,
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
