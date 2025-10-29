/**
 * STRATEGY EXECUTOR - Core Logic
 *
 * Core execution logic for autonomous strategy execution cron job.
 * Handles finding due strategies, executing them, and updating state.
 *
 * This module is separated for testability and reusability.
 */

import { createClient } from '@supabase/supabase-js'
import { workflowExecutor } from '@/lib/workflow/executor'
import type { Workflow, ExecutionResult } from '@/types/workflow'

// Initialize Supabase client with service role for cron job
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface StrategyRecord {
  strategy_id: string
  strategy_name: string
  created_by: string
  node_graph: any
  execution_mode: string
  schedule_cron: string | null
  is_active: boolean
  trading_mode: string
  paper_bankroll_usd: number | null
  last_executed_at: string | null
  total_executions: number
  avg_execution_time_ms: number | null
}

interface ExecutionSummary {
  success: boolean
  strategyId: string
  strategyName: string
  executionId?: string
  duration?: number
  nodesExecuted?: number
  error?: string
}

/**
 * Find strategies that are due for execution
 *
 * Query criteria:
 * - execution_mode = 'SCHEDULED'
 * - is_active = TRUE
 * - Due based on schedule_cron and last_executed_at
 * - Limit to 25 strategies (Vercel timeout protection)
 */
export async function findDueStrategies(): Promise<StrategyRecord[]> {
  const now = new Date()

  // Fetch all scheduled and active strategies - select specific columns to reduce egress
  const { data, error} = await supabase
    .from('strategy_definitions')
    .select('strategy_id, strategy_name, created_by, node_graph, execution_mode, schedule_cron, is_active, trading_mode, paper_bankroll_usd, last_executed_at, total_executions, avg_execution_time_ms')
    .eq('execution_mode', 'SCHEDULED')
    .eq('is_active', true)
    .limit(25)

  if (error) {
    console.error('[Strategy Executor] Error fetching due strategies:', error)
    throw error
  }

  if (!data || data.length === 0) {
    return []
  }

  // Filter strategies that are due based on their schedule_cron
  const dueStrategies = data.filter(strategy => {
    if (!strategy.schedule_cron) return false

    const intervalMinutes = cronToMinutes(strategy.schedule_cron)
    if (intervalMinutes === null) return false

    const lastExecuted = strategy.last_executed_at
      ? new Date(strategy.last_executed_at)
      : new Date(0) // If never executed, it's due

    const nextExecution = new Date(lastExecuted.getTime() + intervalMinutes * 60 * 1000)

    return now >= nextExecution
  })

  return dueStrategies
}

/**
 * Convert cron expression to minutes interval
 *
 * Supports common patterns:
 * - "* * * * *" → 1 minute
 * - "*\/5 * * * *" → 5 minutes
 * - "*\/15 * * * *" → 15 minutes
 * - "*\/30 * * * *" → 30 minutes
 * - "0 * * * *" → 60 minutes
 */
function cronToMinutes(cron: string): number | null {
  const cronMap: Record<string, number> = {
    '* * * * *': 1,
    '*/5 * * * *': 5,
    '*/15 * * * *': 15,
    '*/30 * * * *': 30,
    '0 * * * *': 60,
  }

  return cronMap[cron] || null
}

/**
 * Execute a single strategy
 *
 * Wraps WorkflowExecutor.execute() with error handling and logging.
 */
export async function executeStrategy(
  strategy: StrategyRecord
): Promise<ExecutionSummary> {
  const startTime = Date.now()

  try {
    console.log(`[Strategy Executor] Executing strategy: ${strategy.strategy_name} (${strategy.strategy_id})`)

    // Extract nodes and edges from node_graph
    const nodeGraph = strategy.node_graph || {}
    const nodes = nodeGraph.nodes || []
    const edges = nodeGraph.edges || []

    // Convert database record to Workflow type
    const workflow: Workflow = {
      id: strategy.strategy_id,
      name: strategy.strategy_name,
      nodes,
      edges,
      variables: {},
      trigger: { type: 'schedule' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Execute workflow using existing executor
    const result: ExecutionResult = await workflowExecutor.execute(workflow)

    const duration = Date.now() - startTime

    if (result.success) {
      console.log(`[Strategy Executor] ✅ Success: ${strategy.strategy_name} (${duration}ms)`)
      return {
        success: true,
        strategyId: strategy.strategy_id,
        strategyName: strategy.strategy_name,
        executionId: result.executionId,
        duration,
        nodesExecuted: result.nodesExecuted,
      }
    } else {
      console.error(`[Strategy Executor] ❌ Failed: ${strategy.strategy_name}`, result.errors)
      return {
        success: false,
        strategyId: strategy.strategy_id,
        strategyName: strategy.strategy_name,
        duration,
        error: result.errors?.map(e => `${e.nodeId}: ${e.error}`).join('; '),
      }
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error(`[Strategy Executor] ❌ Exception: ${strategy.strategy_name}`, error)
    return {
      success: false,
      strategyId: strategy.strategy_id,
      strategyName: strategy.strategy_name,
      duration,
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Update strategy record after execution
 *
 * Updates:
 * - last_executed_at
 * - total_executions (increment)
 * - avg_execution_time_ms (rolling average)
 *
 * Also creates an execution log record for tracking
 */
export async function updateStrategyAfterExecution(
  strategy: StrategyRecord,
  result: ExecutionSummary
): Promise<void> {
  const now = new Date()

  // Calculate new counters
  const executionCount = strategy.total_executions + 1

  // Calculate rolling average execution time
  const averageExecutionTime = calculateAverageExecutionTime(
    strategy.avg_execution_time_ms || 0,
    strategy.total_executions,
    result.duration || 0
  )

  // Update strategy_definitions table
  const { error: updateError } = await supabase
    .from('strategy_definitions')
    .update({
      last_executed_at: now.toISOString(),
      total_executions: executionCount,
      avg_execution_time_ms: Math.round(averageExecutionTime),
    })
    .eq('strategy_id', strategy.strategy_id)

  if (updateError) {
    console.error('[Strategy Executor] Error updating strategy:', updateError)
    throw updateError
  }

  // Create execution log record
  const { error: logError } = await supabase
    .from('strategy_execution_logs')
    .insert({
      strategy_id: strategy.strategy_id,
      status: result.success ? 'completed' : 'failed',
      execution_time_ms: result.duration || 0,
      nodes_executed: result.nodesExecuted || 0,
      error_message: result.error || null,
      executed_at: now.toISOString(),
    })

  if (logError) {
    console.error('[Strategy Executor] Error creating execution log:', logError)
    // Don't throw - logging is not critical
  }

  console.log(
    `[Strategy Executor] Updated ${strategy.strategy_name}: ` +
      `${executionCount} total executions, avg ${Math.round(averageExecutionTime)}ms` +
      (result.success ? ' ✅' : ' ❌')
  )
}

/**
 * Calculate rolling average execution time
 *
 * Formula: (previousAvg * previousCount + newTime) / (previousCount + 1)
 *
 * @param previousAvg - Previous average execution time (ms)
 * @param previousCount - Number of previous executions
 * @param newExecutionTime - New execution time (ms)
 * @returns New average execution time (ms)
 */
export function calculateAverageExecutionTime(
  previousAvg: number,
  previousCount: number,
  newExecutionTime: number
): number {
  if (previousCount === 0) {
    return newExecutionTime
  }

  return (previousAvg * previousCount + newExecutionTime) / (previousCount + 1)
}

/**
 * Execute all due strategies
 *
 * Main entry point for cron job.
 * Returns summary of executions for monitoring.
 */
export async function executeAllDueStrategies(): Promise<{
  strategiesChecked: number
  strategiesExecuted: number
  executions: ExecutionSummary[]
  executionTime: number
}> {
  const startTime = Date.now()

  console.log('\n🤖 STRATEGY EXECUTOR CRON JOB')
  console.log('='.repeat(60))

  // Find strategies due for execution
  const dueStrategies = await findDueStrategies()
  console.log(`📊 Found ${dueStrategies.length} strategies due for execution`)

  if (dueStrategies.length === 0) {
    console.log('✅ No strategies due for execution')
    console.log('='.repeat(60))
    return {
      strategiesChecked: 0,
      strategiesExecuted: 0,
      executions: [],
      executionTime: Date.now() - startTime,
    }
  }

  // Execute each strategy
  const executions: ExecutionSummary[] = []

  for (const strategy of dueStrategies) {
    const result = await executeStrategy(strategy)
    executions.push(result)

    // Update strategy record
    await updateStrategyAfterExecution(strategy, result)
  }

  const executionTime = Date.now() - startTime

  // Summary
  const successCount = executions.filter(e => e.success).length
  const errorCount = executions.filter(e => !e.success).length

  console.log('\n' + '='.repeat(60))
  console.log('📊 EXECUTION SUMMARY')
  console.log('='.repeat(60))
  console.log(`Strategies Checked:   ${dueStrategies.length}`)
  console.log(`Strategies Executed:  ${executions.length}`)
  console.log(`Successful:           ${successCount}`)
  console.log(`Failed:               ${errorCount}`)
  console.log(`Total Time:           ${(executionTime / 1000).toFixed(1)}s`)
  console.log('='.repeat(60))

  return {
    strategiesChecked: dueStrategies.length,
    strategiesExecuted: executions.length,
    executions,
    executionTime,
  }
}
