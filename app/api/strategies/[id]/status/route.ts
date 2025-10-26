/**
 * Strategy Status API Endpoint
 * GET /api/strategies/[id]/status
 *
 * Returns comprehensive status and metrics for a strategy
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 3 - Strategy Control API Endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Calculate uptime in seconds from first execution to now
 */
function calculateUptime(createdAt: string, lastExecutedAt: string | null): number {
  if (!lastExecutedAt) {
    return 0;
  }

  const startTime = new Date(createdAt).getTime();
  const now = Date.now();
  const uptimeMs = now - startTime;

  return Math.floor(uptimeMs / 1000);
}

/**
 * Calculate success rate
 */
function calculateSuccessRate(successCount: number, executionCount: number): number {
  if (executionCount === 0) {
    return 0;
  }

  return successCount / executionCount;
}

/**
 * GET /api/strategies/[id]/status
 *
 * Returns comprehensive strategy status and metrics
 *
 * Response:
 * - 200: Strategy status retrieved successfully
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

    // Create Supabase client with service role
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch strategy with all relevant fields
    const { data: strategy, error: fetchError } = await supabase
      .from('workflow_sessions')
      .select('*')
      .eq('id', id)
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

    // Get watchlist size
    const { count: watchlistSize, error: watchlistError } = await supabase
      .from('strategy_watchlists')
      .select('*', { count: 'exact', head: true })
      .eq('workflow_id', id);

    if (watchlistError) {
      console.warn('[Strategy Status API] Failed to fetch watchlist size:', watchlistError);
    }

    // Calculate metrics
    const executionCount = strategy.execution_count || 0;
    const successCount = strategy.success_count || 0;
    const errorCount = strategy.error_count || 0;
    const successRate = calculateSuccessRate(successCount, executionCount);
    const uptimeSeconds = calculateUptime(strategy.created_at, strategy.last_executed_at);

    return NextResponse.json({
      success: true,
      data: {
        id: strategy.id,
        name: strategy.name,
        status: strategy.status,
        auto_run: strategy.auto_run,
        execution_interval_minutes: strategy.execution_interval_minutes,
        last_executed_at: strategy.last_executed_at,
        next_execution_at: strategy.next_execution_at,
        execution_count: executionCount,
        success_count: successCount,
        error_count: errorCount,
        success_rate: successRate,
        average_execution_time_ms: strategy.average_execution_time_ms,
        uptime_seconds: uptimeSeconds,
        watchlist_size: watchlistSize || 0,
        active_trades: 0, // Future: Phase 3 - Live trading integration
        created_at: strategy.created_at,
        updated_at: strategy.updated_at,
      },
    });
  } catch (error) {
    console.error('[Strategy Status API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch strategy status',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
