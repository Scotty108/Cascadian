/**
 * GET /api/polymarket/markets
 *
 * Fetch markets from database with filters
 * Triggers sync if data is stale
 * Optionally includes trade analytics data
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncPolymarketData, isDataStale, getSyncStatus } from '@/lib/polymarket/sync';
import type { PaginatedResponse, CascadianMarket } from '@/types/polymarket';

export const dynamic = 'force-dynamic';

/**
 * Parse query parameters
 */
function parseQueryParams(searchParams: URLSearchParams) {
  const category = searchParams.get('category') || undefined;
  const active = searchParams.get('active') === 'false' ? false : true;
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const sort = (searchParams.get('sort') || 'volume') as 'volume' | 'liquidity' | 'created_at' | 'momentum' | 'trades';
  const includeAnalytics = searchParams.get('include_analytics') === 'true';

  return { category, active, limit, offset, sort, includeAnalytics };
}

/**
 * GET handler
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const { category, active, limit, offset, sort, includeAnalytics } = parseQueryParams(searchParams);

    // Check if data is stale
    const stale = await isDataStale();
    const syncStatus = await getSyncStatus();

    // Trigger sync if stale (non-blocking)
    if (stale && !syncStatus.sync_in_progress) {
      console.log('[API] Data is stale, triggering sync in background');
      // Fire and forget - don't await
      syncPolymarketData().catch(error => {
        console.error('[API] Background sync failed:', error);
      });
    }

    // Build query - explicitly handle analytics join
    let selectQuery = '*';
    if (includeAnalytics) {
      selectQuery = '*, market_analytics(*)';
    }

    let query = supabaseAdmin
      .from('markets')
      .select(selectQuery, { count: 'exact' });

    // Apply filters
    if (category) {
      query = query.eq('category', category);
    }

    query = query.eq('active', active);

    // Apply sorting
    let sortColumn: string;

    switch (sort) {
      case 'volume':
        sortColumn = 'volume_24h';
        break;
      case 'liquidity':
        sortColumn = 'liquidity';
        break;
      case 'created_at':
        sortColumn = 'created_at';
        break;
      case 'momentum':
      case 'trades':
        // Note: Sorting by joined table columns doesn't work well in Supabase
        // Fall back to volume for now
        sortColumn = 'volume_24h';
        break;
      default:
        sortColumn = 'volume_24h';
    }

    query = query.order(sortColumn, { ascending: false });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    // Execute query
    const { data, error, count } = await query;

    if (error) {
      console.error('[API] Database query failed:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch markets',
          details: error.message,
        },
        { status: 500 }
      );
    }

    // Transform database rows to CascadianMarket format
    const markets: CascadianMarket[] = (data || []).map((row: any) => {
      const market: CascadianMarket = {
        market_id: row.market_id,
        title: row.title,
        description: row.description || '',
        category: row.category || 'Other',
        current_price: parseFloat(row.current_price || '0'),
        volume_24h: parseFloat(row.volume_24h || '0'),
        volume_total: parseFloat(row.volume_total || '0'),
        liquidity: parseFloat(row.liquidity || '0'),
        active: row.active,
        closed: row.closed,
        end_date: new Date(row.end_date),
        outcomes: row.outcomes || ['Yes', 'No'],
        slug: row.slug || row.market_id,
        image_url: row.image_url,
        raw_data: row.raw_polymarket_data || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      };

      // Add analytics if included and available
      if (includeAnalytics && row.market_analytics) {
        const analytics = Array.isArray(row.market_analytics)
          ? row.market_analytics[0]
          : row.market_analytics;

        if (analytics) {
          market.analytics = {
            market_id: row.market_id,
            condition_id: row.condition_id,
            trades_24h: analytics.trades_24h || 0,
            buyers_24h: analytics.buyers_24h || 0,
            sellers_24h: analytics.sellers_24h || 0,
            buy_sell_ratio: parseFloat(analytics.buy_sell_ratio || '1.0'),
            buy_volume_24h: parseFloat(analytics.buy_volume_24h || '0'),
            sell_volume_24h: parseFloat(analytics.sell_volume_24h || '0'),
            momentum_score: parseFloat(analytics.momentum_score || '0'),
            price_change_24h: parseFloat(analytics.price_change_24h || '0'),
            last_aggregated_at: analytics.last_aggregated_at,
          };
        }
      }

      return market;
    });

    // Calculate page number
    const page = Math.floor(offset / limit) + 1;

    // Build response
    const response: PaginatedResponse<CascadianMarket> = {
      success: true,
      data: markets,
      total: count || 0,
      page,
      limit,
      stale: stale || syncStatus.sync_in_progress,
      last_synced: syncStatus.last_synced?.toISOString(),
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[API] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
