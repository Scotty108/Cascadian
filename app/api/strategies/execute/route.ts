/**
 * Strategy Execution API
 * POST /api/strategies/execute
 *
 * Executes a strategy and returns results
 */

import { NextRequest, NextResponse } from 'next/server';
import { strategyEngine } from '@/lib/strategy-builder';
import { createClient } from '@supabase/supabase-js';
import type { ExecutionContext } from '@/lib/strategy-builder/types';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { strategy_id, user_id } = body;

    if (!strategy_id) {
      return NextResponse.json(
        { error: 'strategy_id is required' },
        { status: 400 }
      );
    }

    // Fetch strategy definition from database
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: strategy, error } = await supabase
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_id', strategy_id)
      .single();

    if (error || !strategy) {
      return NextResponse.json(
        { error: 'Strategy not found' },
        { status: 404 }
      );
    }

    // Create execution context
    const context: ExecutionContext = {
      strategyId: strategy_id,
      executionId: crypto.randomUUID(),
      userId: user_id,
      mode: 'MANUAL',
      startTime: new Date(),
    };

    // Execute strategy
    const result = await strategyEngine.execute(
      {
        ...strategy,
        nodeGraph: strategy.node_graph,
        strategyId: strategy.strategy_id,
        strategyName: strategy.strategy_name,
        strategyDescription: strategy.strategy_description,
        strategyType: strategy.strategy_type,
        isPredefined: strategy.is_predefined,
        executionMode: strategy.execution_mode,
        scheduleCron: strategy.schedule_cron,
        isActive: strategy.is_active,
        createdBy: strategy.created_by,
        createdAt: new Date(strategy.created_at),
        updatedAt: new Date(strategy.updated_at),
      },
      context
    );

    // Return results
    return NextResponse.json({
      success: true,
      execution_id: result.executionId,
      strategy_id: result.strategyId,
      status: result.status,
      execution_time_ms: result.totalExecutionTimeMs,
      nodes_evaluated: result.nodesEvaluated,
      data_points_processed: result.dataPointsProcessed,
      results: {
        aggregations: result.aggregations,
        signals_generated: result.signalsGenerated?.length || 0,
        actions_executed: result.actionsExecuted?.length || 0,
      },
      // Include detailed results for debugging
      detailed_results: result.results,
    });
  } catch (error) {
    console.error('Strategy execution error:', error);

    return NextResponse.json(
      {
        error: 'Strategy execution failed',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/strategies/execute?strategy_id=xxx
 *
 * Get execution history for a strategy
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const strategy_id = searchParams.get('strategy_id');

    if (!strategy_id) {
      return NextResponse.json(
        { error: 'strategy_id is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: executions, error } = await supabase
      .from('strategy_executions')
      .select('*')
      .eq('strategy_id', strategy_id)
      .order('executed_at', { ascending: false })
      .limit(10);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      executions: executions || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch execution history',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
