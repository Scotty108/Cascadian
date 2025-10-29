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
import { withCache, getCacheStats } from '@/lib/cache/memory-cache';
import type { PaginatedResponse, CascadianMarket } from '@/types/polymarket';

export const dynamic = 'force-dynamic';

/**
 * Helper to add timeout to promises
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), ms)
  );
  return Promise.race([promise, timeout]);
}

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

    // Generate cache key from query params
    const cacheKey = `markets:${category || 'all'}:${active}:${limit}:${offset}:${sort}:${includeAnalytics}`;

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

    // Use cache wrapper for database query + transformation
    const result = await withCache(
      cacheKey,
      async () => {
        // Build query - only select needed columns to reduce egress
        let selectQuery = 'market_id, title, description, category, current_price, volume_24h, volume_total, liquidity, active, closed, end_date, outcomes, slug, image_url, raw_polymarket_data, created_at, updated_at, condition_id';
        if (includeAnalytics) {
          selectQuery += ', market_analytics(market_id, condition_id, trades_24h, buyers_24h, sellers_24h, buy_sell_ratio, price_change_24h, momentum_score)';
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

        // Execute query with 10 second timeout
        const result: any = await withTimeout(
          Promise.resolve(query),
          10000
        );
        const { data, error, count } = result;

        if (error) {
          console.error('[API] Database query failed:', error);
          throw new Error(`Database query failed: ${error.message}`);
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
        return {
          success: true,
          data: markets,
          total: count || 0,
          page,
          limit,
          stale: stale || syncStatus.sync_in_progress,
          last_synced: syncStatus.last_synced?.toISOString(),
        };
      },
      30000  // Cache for 30 seconds
    );

    // Log cache stats periodically
    const stats = getCacheStats();
    if (stats.size % 10 === 0) {
      console.log(`[Cache] Stats: ${stats.size}/${stats.maxSize} entries`);
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[API] Unexpected error:', error);

    // If timeout, return empty data gracefully
    if (error instanceof Error && error.message === 'Request timeout') {
      return NextResponse.json({
        data: [],
        total: 0,
        page: 1,
        limit: 100,
        stale: true,
        last_synced: null,
        message: 'Database connection timeout - please try again or upgrade Supabase plan',
      });
    }

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
