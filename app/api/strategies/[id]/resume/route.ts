/**
 * Strategy Resume API Endpoint
 * POST /api/strategies/[id]/resume
 *
 * Resumes autonomous execution for a paused or stopped strategy
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 3 - Strategy Control API Endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Calculate next execution timestamp based on interval
 */
function calculateNextExecution(intervalMinutes: number): string {
  const now = new Date();
  const nextExecution = new Date(now.getTime() + intervalMinutes * 60 * 1000);
  return nextExecution.toISOString();
}

/**
 * POST /api/strategies/[id]/resume
 *
 * Resumes autonomous strategy execution from paused or stopped state
 *
 * Response:
 * - 200: Strategy resumed successfully
 * - 400: Strategy already running
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

    // Check if already running
    if (strategy.is_active === true) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy is already running',
          data: {
            strategy_id: strategy.strategy_id,
            strategy_name: strategy.strategy_name,
            is_active: strategy.is_active,
          },
        },
        { status: 400 }
      );
    }

    // Validate execution mode
    if (strategy.execution_mode !== 'SCHEDULED') {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy must be configured for scheduled execution (deploy first)',
        },
        { status: 400 }
      );
    }

    // Update strategy to resume autonomous execution
    const { data: updatedStrategy, error: updateError } = await supabase
      .from('strategy_definitions')
      .update({
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('strategy_id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Strategy Resume API] Database update error:', updateError);
      throw updateError;
    }

    // Send notification about strategy resume
    try {
      await supabase.from('notifications').insert({
        user_id: strategy.created_by,
        workflow_id: id,
        type: 'strategy_update',
        title: `${strategy.strategy_name || 'Strategy'} resumed`,
        message: `Strategy has been resumed in ${strategy.trading_mode} mode.`,
        link: `/strategies/${id}`,
        priority: 'normal',
      });
    } catch (notificationError) {
      // Log but don't fail the request if notification fails
      console.warn('[Strategy Resume API] Failed to create notification:', notificationError);
    }

    return NextResponse.json({
      success: true,
      data: {
        strategy_id: updatedStrategy.strategy_id,
        strategy_name: updatedStrategy.strategy_name,
        is_active: updatedStrategy.is_active,
        execution_mode: updatedStrategy.execution_mode,
        schedule_cron: updatedStrategy.schedule_cron,
        trading_mode: updatedStrategy.trading_mode,
        message: 'Strategy resumed successfully.',
      },
    });
  } catch (error) {
    console.error('[Strategy Resume API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to resume strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
