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
  created_at: string;
  updated_at: string;
}

// Convert group_slug to readable title
function slugToTitle(slug: string): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Parse outcome prices from JSON string
function parseOutcomePrices(pricesStr: string): number {
  try {
    const prices = JSON.parse(pricesStr || '[]');
    // Return YES price (first outcome)
    return parseFloat(prices[0] || '0.5');
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
        created_at,
        updated_at
      FROM pm_market_metadata
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as MarketRow[];

    // Transform to API response format matching the old Supabase format
    const markets = rows.map((row) => {
      const currentPrice = parseOutcomePrices(row.outcome_prices);
      const eventTitle = slugToTitle(row.group_slug);

      return {
        market_id: row.condition_id, // Use condition_id as market_id for consistency
        title: row.question,
        description: row.description || '',
        category: row.category || 'Other',
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

    // Get total count for pagination
    const countQuery = `
      SELECT count() as total
      FROM pm_market_metadata
      WHERE ${whereClause}
    `;

    const countResult = await clickhouse.query({
      query: countQuery,
      format: 'JSONEachRow',
    });
    const countRows = (await countResult.json()) as { total: number }[];
    const total = countRows[0]?.total || 0;

    // Get category stats for filtering UI
    const categoryQuery = `
      SELECT
        category,
        count() as count
      FROM pm_market_metadata
      WHERE ${activeOnly ? 'is_active = 1 AND is_closed = 0' : 'is_closed = 1'}
      GROUP BY category
      ORDER BY count DESC
    `;

    const categoryResult = await clickhouse.query({
      query: categoryQuery,
      format: 'JSONEachRow',
    });
    const categories = (await categoryResult.json()) as { category: string; count: number }[];

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
