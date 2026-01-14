/**
 * API: Markets from ClickHouse
 *
 * Returns individual markets from pm_market_metadata table.
 * Replaces the Supabase-backed /api/polymarket/markets endpoint.
 *
 * GET /api/markets
 * Query params:
 *   - limit: number (default: 100, max: 1000)
 *   - offset: number (default: 0)
 *   - category: string (optional) - filter by category
 *   - active: boolean (default: true) - only show active markets
 *   - sortBy: 'volume' | 'volume_24h' | 'liquidity' | 'end_date' | 'created_at' (default: 'volume_24h')
 *   - search: string (optional) - search in question text
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface MarketRow {
  condition_id: string;
  market_id: string;
  question: string;
  description: string;
  category: string;
  volume_usdc: number;
  volume_24hr: number;
  liquidity_usdc: number;
  is_active: number;
  is_closed: number;
  end_date: string | null;
  outcomes: string[];
  outcome_prices: string;
  slug: string;
  image_url: string;
  event_id: string;
  group_slug: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

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

// Convert group_slug to readable title
function slugToTitle(slug: string): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Parse outcome prices from JSON string (handles multi-level encoding and ClickHouse quirks)
// ClickHouse returns: "["0.0035", "0.9965"]" (outer quotes are literal, not JSON escaping)
function parseOutcomePrices(pricesStr: string): number {
  try {
    if (!pricesStr) return 0.5;

    let value = pricesStr;

    // ClickHouse wraps the value in literal outer quotes like: "["0.0035", "0.9965"]"
    // Strip outer quotes if present (but not valid JSON escaping)
    if (value.startsWith('"') && value.endsWith('"') && value.length > 2) {
      // Check if it's the ClickHouse format (starts with "[" after the outer quote)
      if (value.charAt(1) === '[') {
        value = value.slice(1, -1); // Remove outer quotes
      }
    }

    // Now try to parse the array
    let parsed: any = value;
    let attempts = 0;
    while (typeof parsed === 'string' && attempts < 5) {
      try {
        parsed = JSON.parse(parsed);
        attempts++;
      } catch {
        break;
      }
    }

    // Extract first price from array
    if (Array.isArray(parsed) && parsed.length > 0) {
      const price = parseFloat(parsed[0]);
      if (!isNaN(price) && price >= 0 && price <= 1) {
        return price;
      }
    }

    return 0.5;
  } catch {
    return 0.5;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit') || 100), 1000);
    const offset = Number(searchParams.get('offset') || 0);
    const category = searchParams.get('category');
    const tag = searchParams.get('tag'); // Filter by tag (e.g., "AI", "Bitcoin", "Trump")
    const activeOnly = searchParams.get('active') !== 'false';
    const sortBy = searchParams.get('sortBy') || 'volume_24h';
    const search = searchParams.get('search');

    // Build WHERE conditions
    const conditions: string[] = [];

    if (activeOnly) {
      conditions.push('is_active = 1');
      conditions.push('is_closed = 0');
    } else {
      conditions.push('is_closed = 1');
    }

    if (category) {
      conditions.push(`category = '${category.replace(/'/g, "''")}'`);
    }

    // Tag filter - check if tag exists in tags array
    if (tag) {
      const escapedTag = tag.replace(/'/g, "''");
      conditions.push(`has(tags, '${escapedTag}')`);
    }

    if (search) {
      const escapedSearch = search.replace(/'/g, "''").toLowerCase();
      conditions.push(`lower(question) LIKE '%${escapedSearch}%'`);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    // Build ORDER BY clause
    let orderBy = 'volume_24hr DESC';
    switch (sortBy) {
      case 'volume':
        orderBy = 'volume_usdc DESC';
        break;
      case 'volume_24h':
        orderBy = 'volume_24hr DESC';
        break;
      case 'liquidity':
        orderBy = 'liquidity_usdc DESC';
        break;
      case 'end_date':
        orderBy = 'end_date ASC';
        break;
      case 'created_at':
        orderBy = 'created_at DESC';
        break;
    }

    // Main query to get markets
    const query = `
      SELECT
        condition_id,
        market_id,
        question,
        description,
        category,
        volume_usdc,
        volume_24hr,
        liquidity_usdc,
        is_active,
        is_closed,
        end_date,
        outcomes,
        outcome_prices,
        slug,
        image_url,
        event_id,
        group_slug,
        tags,
        created_at,
        updated_at
      FROM pm_market_metadata
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Count query for pagination
    const countQuery = `
      SELECT count() as total
      FROM pm_market_metadata
      WHERE ${whereClause}
    `;

    // Category stats query for filtering UI
    const categoryQuery = `
      SELECT
        category,
        count() as count
      FROM pm_market_metadata
      WHERE ${activeOnly ? 'is_active = 1 AND is_closed = 0' : 'is_closed = 1'}
      GROUP BY category
      ORDER BY count DESC
    `;

    // Run all 3 queries in PARALLEL for speed
    const [mainResult, countResult, categoryResult] = await Promise.all([
      clickhouse.query({ query, format: 'JSONEachRow' }),
      clickhouse.query({ query: countQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: categoryQuery, format: 'JSONEachRow' }),
    ]);

    const [rows, countRows, categories] = await Promise.all([
      mainResult.json() as Promise<MarketRow[]>,
      countResult.json() as Promise<{ total: number }[]>,
      categoryResult.json() as Promise<{ category: string; count: number }[]>,
    ]);

    const total = countRows[0]?.total || 0;

    // Transform to API response format matching the old Supabase format
    const markets = rows.map((row) => {
      const currentPrice = parseOutcomePrices(row.outcome_prices);
      const eventTitle = slugToTitle(row.group_slug);

      return {
        market_id: row.condition_id, // Use condition_id as market_id for consistency
        title: row.question,
        description: row.description || '',
        category: correctCategory(row.category, row.question || ''),
        current_price: currentPrice,
        volume_24h: row.volume_24hr || 0,
        volume_total: row.volume_usdc || 0,
        liquidity: row.liquidity_usdc || 0,
        active: row.is_active === 1,
        closed: row.is_closed === 1,
        end_date: row.end_date,
        outcomes: row.outcomes || ['Yes', 'No'],
        slug: row.slug || row.condition_id,
        image_url: row.image_url || null,
        tags: row.tags || [],
        created_at: row.created_at,
        updated_at: row.updated_at,
        event_id: row.event_id || null,
        event_slug: row.group_slug || null,
        event_title: eventTitle || null,
        raw_data: {
          event_id: row.event_id,
          event_title: eventTitle,
          event_slug: row.group_slug,
          icon: row.image_url,
          polymarket_market_id: row.market_id,
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: markets,
      total,
      categories,
      page: Math.floor(offset / limit) + 1,
      limit,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });

  } catch (error: any) {
    console.error('[markets] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      data: [],
      total: 0,
    }, { status: 500 });
  }
}
