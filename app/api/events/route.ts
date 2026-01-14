/**
 * API: Events from ClickHouse
 *
 * Returns events aggregated from pm_market_metadata table.
 * Replaces the Polymarket Gamma API dependency.
 *
 * GET /api/events
 * Query params:
 *   - limit: number (default: 100, max: 500)
 *   - offset: number (default: 0)
 *   - category: string (optional) - filter by category
 *   - active: boolean (default: true) - only show active events
 *   - sortBy: 'volume' | 'liquidity' | 'markets' | 'ending' (default: 'volume')
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface EventRow {
  event_id: string;
  group_slug: string;
  category: string;
  image_url: string;
  market_count: number;
  total_volume: number;
  total_liquidity: number;
  end_date: string | null;
  active_markets: number;
  sample_question: string;
}

// Convert group_slug to readable title
function slugToTitle(slug: string): string {
  if (!slug) return 'Untitled Event';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500);
    const offset = Number(searchParams.get('offset') || 0);
    const category = searchParams.get('category');
    const activeOnly = searchParams.get('active') !== 'false';
    const sortBy = searchParams.get('sortBy') || 'volume';

    // Build WHERE conditions
    const conditions: string[] = ["event_id != ''"];

    if (category) {
      conditions.push(`category = '${category}'`);
    }

    const whereClause = conditions.join(' AND ');

    // Build ORDER BY clause
    let orderBy = 'total_volume DESC';
    switch (sortBy) {
      case 'liquidity':
        orderBy = 'total_liquidity DESC';
        break;
      case 'markets':
        orderBy = 'market_count DESC';
        break;
      case 'ending':
        orderBy = 'end_date ASC';
        break;
    }

    // Main query to get events
    const query = `
      SELECT
        event_id,
        any(group_slug) as group_slug,
        any(category) as category,
        any(image_url) as image_url,
        count() as market_count,
        sum(volume_usdc) as total_volume,
        sum(liquidity_usdc) as total_liquidity,
        max(end_date) as end_date,
        countIf(is_closed = 0) as active_markets,
        any(question) as sample_question
      FROM pm_market_metadata
      WHERE ${whereClause}
      GROUP BY event_id
      ${activeOnly ? 'HAVING active_markets > 0' : ''}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Count query
    const countQuery = `
      SELECT count(DISTINCT event_id) as total
      FROM pm_market_metadata
      WHERE ${whereClause}
      ${activeOnly ? 'AND is_closed = 0' : ''}
    `;

    // Category stats query
    const categoryQuery = `
      SELECT
        category,
        count(DISTINCT event_id) as count
      FROM pm_market_metadata
      WHERE event_id != ''
        ${activeOnly ? 'AND is_closed = 0' : ''}
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
      mainResult.json() as Promise<EventRow[]>,
      countResult.json() as Promise<{ total: number }[]>,
      categoryResult.json() as Promise<{ category: string; count: number }[]>,
    ]);

    const total = countRows[0]?.total || 0;

    // Transform to API response format
    const events = rows.map((row) => ({
      id: row.event_id,
      slug: row.group_slug || row.event_id,
      title: slugToTitle(row.group_slug) || row.sample_question?.split('?')[0] || 'Untitled Event',
      description: row.sample_question || '',
      category: row.category || 'Other',
      image: row.image_url || null,
      marketCount: row.market_count,
      volume: row.total_volume,
      liquidity: row.total_liquidity,
      endDate: row.end_date,
      activeMarkets: row.active_markets,
      isActive: row.active_markets > 0,
    }));

    return NextResponse.json({
      success: true,
      data: events,
      total,
      categories,
      pagination: {
        limit,
        offset,
        hasMore: offset + events.length < total,
      },
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[events] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      data: [],
    }, { status: 500 });
  }
}
