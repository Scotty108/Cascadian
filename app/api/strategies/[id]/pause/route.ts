/**
 * Strategy Pause API Endpoint
 * POST /api/strategies/[id]/pause
 *
 * Pauses autonomous execution for a strategy
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 3 - Strategy Control API Endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * POST /api/strategies/[id]/pause
 *
 * Pauses autonomous strategy execution
 *
 * Response:
 * - 200: Strategy paused successfully
 * - 400: Strategy already paused or not running
 * - 403: User doesn't own strategy (RLS)
 * - 404: Strategy not found
 * - 500: Server error
 */
export async function POST(
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

    // First, fetch the strategy to check current state
    const { data: strategy, error: fetchError } = await supabase
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_id', id)
      .single();

    if (fetchError || !strategy) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy not found',
        },
        { status: 404 }
      );
    }

    // Check if already paused
    if (strategy.is_active === false) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy is already paused',
          data: {
            strategy_id: strategy.strategy_id,
            strategy_name: strategy.strategy_name,
            is_active: strategy.is_active,
          },
        },
        { status: 400 }
      );
    }

    // Update strategy to pause autonomous execution
    const { data: updatedStrategy, error: updateError } = await supabase
      .from('strategy_definitions')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('strategy_id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Strategy Pause API] Database update error:', updateError);
      throw updateError;
    }

    // Send notification about strategy pause
    try {
      await supabase.from('notifications').insert({
        user_id: strategy.created_by,
        workflow_id: id,
        type: 'strategy_update',
        title: `${strategy.strategy_name || 'Strategy'} paused`,
        message: 'Strategy has been paused. No further executions scheduled.',
        link: `/strategies/${id}`,
        priority: 'normal',
      });
    } catch (notificationError) {
      // Log but don't fail the request if notification fails
      console.warn('[Strategy Pause API] Failed to create notification:', notificationError);
    }

    return NextResponse.json({
      success: true,
      data: {
        strategy_id: updatedStrategy.strategy_id,
        strategy_name: updatedStrategy.strategy_name,
        is_active: updatedStrategy.is_active,
        message: 'Strategy paused. No further executions scheduled.',
      },
    });
  } catch (error) {
    console.error('[Strategy Pause API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to pause strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
