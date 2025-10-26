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
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeAllDueStrategies } from './executor'

/**
 * Verify cron secret for security
 *
 * Checks Authorization header for Bearer token matching CRON_SECRET.
 * Falls back to ADMIN_API_KEY if CRON_SECRET not set.
 * In development, allows requests if no secret configured.
 */
function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY

  if (!cronSecret) {
    console.warn('[Strategy Executor] No CRON_SECRET configured, allowing request')
    return true // Allow if not configured (dev mode)
  }

  return authHeader === `Bearer ${cronSecret}`
}

/**
 * GET endpoint for Vercel Cron
 *
 * Called by Vercel Cron on schedule (every 1 minute).
 * Executes all strategies due for execution.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  // Verify authorization
  if (!verifyAuth(request)) {
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
