/**
 * Strategy Execute Now API Endpoint
 * POST /api/strategies/[id]/execute-now
 *
 * Triggers immediate manual execution of a strategy without affecting schedule
 *
 * Feature: Autonomous Strategy Execution System
 * Task Group: 3 - Strategy Control API Endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { executeStrategy } from '@/app/api/cron/strategy-executor/executor';

export const runtime = 'nodejs';

/**
 * POST /api/strategies/[id]/execute-now
 *
 * Triggers immediate manual execution of a strategy
 * Does NOT update next_execution_at (maintains autonomous schedule)
 *
 * Response:
 * - 200: Execution started successfully
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

    // Fetch the strategy
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

    console.log(`[Execute Now API] Manual execution triggered for: ${strategy.name} (${id})`);

    // Execute strategy using the same logic as cron job
    const result = await executeStrategy({
      id: strategy.id,
      name: strategy.name,
      user_id: strategy.user_id,
      nodes: strategy.nodes,
      edges: strategy.edges,
      variables: strategy.variables,
      trigger: strategy.trigger,
      auto_run: strategy.auto_run,
      status: strategy.status,
      execution_interval_minutes: strategy.execution_interval_minutes,
      next_execution_at: strategy.next_execution_at,
      last_executed_at: strategy.last_executed_at,
      execution_count: strategy.execution_count || 0,
      success_count: strategy.success_count || 0,
      error_count: strategy.error_count || 0,
      average_execution_time_ms: strategy.average_execution_time_ms,
    });

    // Update execution metrics WITHOUT changing next_execution_at
    // This preserves the autonomous schedule
    const now = new Date().toISOString();
    const executionCount = (strategy.execution_count || 0) + 1;
    const successCount = result.success
      ? (strategy.success_count || 0) + 1
      : strategy.success_count || 0;
    const errorCount = result.success ? strategy.error_count || 0 : (strategy.error_count || 0) + 1;

    // Calculate rolling average execution time
    const previousAvg = strategy.average_execution_time_ms || 0;
    const previousCount = strategy.execution_count || 0;
    const newTime = result.duration || 0;
    const averageExecutionTime =
      previousCount === 0
        ? newTime
        : (previousAvg * previousCount + newTime) / (previousCount + 1);

    await supabase
      .from('workflow_sessions')
      .update({
        last_executed_at: now,
        execution_count: executionCount,
        success_count: successCount,
        error_count: errorCount,
        average_execution_time_ms: Math.round(averageExecutionTime),
        // Note: next_execution_at is NOT updated - maintains autonomous schedule
      })
      .eq('id', id);

    if (result.success) {
      return NextResponse.json({
        success: true,
        data: {
          execution_id: result.executionId,
          status: 'running',
          duration_ms: result.duration,
          nodes_executed: result.nodesExecuted,
          message: 'Manual execution started. Check execution history for results.',
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        data: {
          execution_id: result.executionId,
          status: 'failed',
          duration_ms: result.duration,
          error: result.error,
          message: 'Manual execution failed.',
        },
      });
    }
  } catch (error) {
    console.error('[Execute Now API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute strategy',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
