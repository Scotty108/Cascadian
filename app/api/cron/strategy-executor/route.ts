/**
 * STRATEGY EXECUTOR CRON JOB ENDPOINT
 *
 * Executes autonomous strategies on a scheduled basis.
 * Runs every 1 minute via Vercel Cron.
 *
 * Features:
 * - Finds strategies due for execution (next_execution_at <= NOW)
 * - Executes workflows using WorkflowExecutor
 * - Updates timestamps and counters
 * - Auto-pauses strategies after 3 consecutive errors
 * - Returns execution summary for monitoring
 *
 * Security:
 * - Requires Authorization: Bearer <CRON_SECRET> header
 * - Uses Supabase service role for database access
 *
 * Performance:
 * - Processes max 25 strategies per run (Vercel timeout protection)
 * - Target execution time: < 5 seconds
 * - Timeout limit: 10 seconds (Vercel default)
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeAllDueStrategies } from './executor'
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest'

/**
 * GET endpoint for Vercel Cron
 *
 * Called by Vercel Cron on schedule (every 1 minute).
 * Executes all strategies due for execution.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  // Auth guard
  const authResult = verifyCronRequest(request, 'strategy-executor')
  if (!authResult.authorized) {
    console.error('[Strategy Executor] Unauthorized cron request')
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or missing CRON_SECRET',
      },
      { status: 401 }
    )
  }

  try {
    // Execute all due strategies
    const result = await executeAllDueStrategies()

    return NextResponse.json({
      success: true,
      data: {
        strategies_checked: result.strategiesChecked,
        strategies_executed: result.strategiesExecuted,
        executions: result.executions.map(e => ({
          workflow_id: e.strategyId,
          workflow_name: e.strategyName,
          status: e.success ? 'completed' : 'failed',
          duration_ms: e.duration,
          nodes_executed: e.nodesExecuted,
          error: e.error,
        })),
        execution_time_ms: result.executionTime,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    const executionTime = Date.now() - startTime

    console.error('[Strategy Executor] Cron job failed:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Unknown error',
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

/**
 * POST endpoint for manual triggers
 *
 * Allows manual execution of cron job via API call.
 * Useful for testing and debugging.
 */
export async function POST(request: NextRequest) {
  return GET(request)
}
