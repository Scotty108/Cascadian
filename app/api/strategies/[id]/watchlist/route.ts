/**
 * Watchlist API Endpoints
 * GET /api/strategies/[id]/watchlist - Get watchlist for strategy
 * DELETE /api/strategies/[id]/watchlist - Clear entire watchlist
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 4.2 & 4.4 - Watchlist API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { enrichWatchlistItems } from '@/lib/analytics/enrich-watchlist';

export const runtime = 'nodejs';

/**
 * GET /api/strategies/[id]/watchlist
 *
 * Returns all markets in the strategy's watchlist
 *
 * Query Parameters:
 * - limit?: number (default: 100, max: 1000)
 * - offset?: number (default: 0)
 *
 * Response:
 * - 200: Watchlist retrieved successfully
 * - 403: User doesn't own strategy (RLS)
 * - 404: Strategy not found
 * - 500: Server error
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Parse pagination parameters
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100'),
      1000
    );
    const offset = parseInt(searchParams.get('offset') || '0');

    // Create Supabase client with service role
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify strategy exists
    const { data: strategy, error: strategyError } = await supabase
      .from('workflow_sessions')
      .select('id, user_id, name')
      .eq('id', id)
      .single();

    if (strategyError || !strategy) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy not found',
        },
        { status: 404 }
      );
    }

    // Get total count
    const { count: totalCount, error: countError } = await supabase
      .from('strategy_watchlists')
      .select('*', { count: 'exact', head: true })
      .eq('workflow_id', id);

    if (countError) {
      console.error('[Watchlist GET] Count error:', countError);
    }

    // Query watchlist with pagination
    const { data: watchlist, error: watchlistError } = await supabase
      .from('strategy_watchlists')
      .select('*')
      .eq('workflow_id', id)
      .order('added_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (watchlistError) {
      console.error('[Watchlist GET] Query error:', watchlistError);
      throw watchlistError;
    }

    // Enrich watchlist with canonical categories and wallet context
    const enrichedWatchlist = enrichWatchlistItems(watchlist || []);

    // Add alerts field based on recency, wallet rank, and coverage
    const now = new Date()
    const enrichedWithAlerts = enrichedWatchlist.map(item => {
      const addedAt = new Date(item.added_at)
      const hoursAgo = (now.getTime() - addedAt.getTime()) / (1000 * 60 * 60)

      // Alert if: within 12 hours AND rank <= 5 AND coverage >= 10%
      const alerts =
        hoursAgo <= 12 &&
        (item.triggering_wallet_rank || 999) <= 5 &&
        (item.triggering_wallet_coverage_pct || 0) >= 10

      return {
        ...item,
        alerts
      }
    })

    return NextResponse.json({
      success: true,
      data: enrichedWithAlerts,
      metadata: {
        total: totalCount || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('[Watchlist GET] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve watchlist',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/strategies/[id]/watchlist
 *
 * Clears all markets from the strategy's watchlist
 *
 * Response:
 * - 200: Watchlist cleared successfully
 * - 403: User doesn't own strategy (RLS)
 * - 404: Strategy not found
 * - 500: Server error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Create Supabase client with service role
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify strategy exists
    const { data: strategy, error: strategyError } = await supabase
      .from('workflow_sessions')
      .select('id, user_id, name')
      .eq('id', id)
      .single();

    if (strategyError || !strategy) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy not found',
        },
        { status: 404 }
      );
    }

    // Get count before deletion
    const { count: beforeCount } = await supabase
      .from('strategy_watchlists')
      .select('*', { count: 'exact', head: true })
      .eq('workflow_id', id);

    // Delete all watchlist entries for this strategy
    const { error: deleteError } = await supabase
      .from('strategy_watchlists')
      .delete()
      .eq('workflow_id', id);

    if (deleteError) {
      console.error('[Watchlist DELETE ALL] Error:', deleteError);
      throw deleteError;
    }

    const removedCount = beforeCount || 0;

    // Send notification about cleared watchlist
    if (removedCount > 0) {
      try {
        await supabase.from('notifications').insert({
          user_id: strategy.user_id,
          workflow_id: id,
          type: 'strategy_update',
          title: `${strategy.name || 'Strategy'} watchlist cleared`,
          message: `Removed ${removedCount} market${removedCount !== 1 ? 's' : ''} from watchlist.`,
          link: `/strategies/${id}`,
          priority: 'normal',
        });
      } catch (notificationError) {
        console.warn('[Watchlist DELETE ALL] Failed to create notification:', notificationError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        removed_count: removedCount,
        message: `Watchlist cleared. Removed ${removedCount} market${removedCount !== 1 ? 's' : ''}.`,
      },
    });
  } catch (error) {
    console.error('[Watchlist DELETE ALL] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to clear watchlist',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
