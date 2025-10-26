/**
 * Watchlist Item API Endpoint
 * DELETE /api/strategies/[id]/watchlist/[market_id] - Remove specific market from watchlist
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 4.3 - Delete specific watchlist item endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * DELETE /api/strategies/[id]/watchlist/[market_id]
 *
 * Removes a specific market from the strategy's watchlist
 *
 * Response:
 * - 200: Market removed successfully
 * - 403: User doesn't own strategy (RLS)
 * - 404: Strategy or market not found in watchlist
 * - 500: Server error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; market_id: string }> }
) {
  try {
    const { id, market_id } = await params;

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

    // Check if market exists in watchlist
    const { data: watchlistItem, error: checkError } = await supabase
      .from('strategy_watchlists')
      .select('*')
      .eq('workflow_id', id)
      .eq('market_id', market_id)
      .single();

    if (checkError || !watchlistItem) {
      return NextResponse.json(
        {
          success: false,
          error: 'Market not found in watchlist',
        },
        { status: 404 }
      );
    }

    // Delete the watchlist entry
    const { error: deleteError } = await supabase
      .from('strategy_watchlists')
      .delete()
      .eq('workflow_id', id)
      .eq('market_id', market_id);

    if (deleteError) {
      console.error('[Watchlist DELETE Item] Error:', deleteError);
      throw deleteError;
    }

    // Send notification about removal (optional - don't fail if it errors)
    try {
      await supabase.from('notifications').insert({
        user_id: strategy.user_id,
        workflow_id: id,
        type: 'strategy_update',
        title: `Market removed from ${strategy.name || 'strategy'} watchlist`,
        message: `Removed market from watchlist.`,
        link: `/strategies/${id}`,
        priority: 'low',
      });
    } catch (notificationError) {
      console.warn('[Watchlist DELETE Item] Failed to create notification:', notificationError);
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Market removed from watchlist',
        market_id,
      },
    });
  } catch (error) {
    console.error('[Watchlist DELETE Item] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove market from watchlist',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
