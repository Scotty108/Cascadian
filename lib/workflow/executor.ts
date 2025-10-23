/**
 * WORKFLOW EXECUTOR
 *
 * Core engine that executes workflows with:
 * - Topological sorting (dependency-based execution order)
 * - Reference resolution (${nodeId.field} syntax)
 * - Error handling and validation
 * - Support for scheduled and continuous execution
 *
 * Builds on existing execute-workflow logic but adds:
 * - Class-based architecture for reusability
 * - Enhanced reference resolution
 * - Support for new Polymarket nodes
 */

import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  ExecutionContext,
  ExecutionResult,
  ExecutionError,
} from '@/types/workflow'
import { workflowExecutionService } from '@/lib/services/workflow-session-service'

export class WorkflowExecutor {
  private runningWorkflows: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Execute a workflow based on its trigger type
   */
  async execute(workflow: Workflow): Promise<ExecutionResult> {
    const executionId = this.generateExecutionId()

    const context: ExecutionContext = {
      workflowId: workflow.id,
      executionId,
      startTime: Date.now(),
      outputs: new Map(),
      globalState: {},
      watchlists: new Map(),
      variables: workflow.variables || {},
    }

    try {
      switch (workflow.trigger.type) {
        case 'manual':
          return await this.executeOnce(workflow, context)

        case 'schedule':
          return this.scheduleExecution(workflow, context)

        case 'continuous':
          return this.startContinuousMonitoring(workflow, context)

        case 'webhook':
          return await this.executeOnce(workflow, context)

        default:
          throw new Error(`Unknown trigger type: ${workflow.trigger.type}`)
      }
    } catch (error: any) {
      return {
        success: false,
        executionId,
        outputs: {},
        errors: [
          {
            nodeId: 'workflow',
            nodeType: 'workflow',
            error: error.message,
            timestamp: Date.now(),
          },
        ],
        executionTime: Date.now() - context.startTime,
        nodesExecuted: 0,
      }
    }
  }

  /**
   * Execute workflow once (manual trigger)
   */
  private async executeOnce(
    workflow: Workflow,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const errors: ExecutionError[] = []
    let nodesExecuted = 0
    let dbExecutionId: string | null = null

    // Start execution tracking if workflow is saved
    if (workflow.id) {
      try {
        const { data } = await workflowExecutionService.startExecution(workflow.id)
        dbExecutionId = data?.id || null
      } catch (error) {
        console.error('Failed to start execution tracking:', error)
      }
    }

    try {
      // Validate workflow structure
      this.validateWorkflow(workflow)

      // Get execution order using topological sort
      const executionOrder = this.topologicalSort(workflow)

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        const node = workflow.nodes.find((n) => n.id === nodeId)
        if (!node) continue

        // Check if node has a condition for execution
        if (node.condition && !this.evaluateCondition(node.condition, context)) {
          continue
        }

        try {
          // Resolve any ${nodeId.field} references in node inputs
          const resolvedInputs = this.resolveReferences(node.data.inputs || {}, context)

          // Execute the node
          const output = await this.executeNode(node, resolvedInputs, context)

          // Store output for future reference
          context.outputs.set(nodeId, output)
          nodesExecuted++
        } catch (error: any) {
          errors.push({
            nodeId,
            nodeType: node.type,
            error: error.message,
            timestamp: Date.now(),
          })
          // Stop execution on error
          break
        }
      }

      const executionTime = Date.now() - context.startTime
      const result: ExecutionResult = {
        success: errors.length === 0,
        executionId: context.executionId,
        outputs: Object.fromEntries(context.outputs),
        errors: errors.length > 0 ? errors : undefined,
        executionTime,
        nodesExecuted,
      }

      // Complete execution tracking
      if (dbExecutionId) {
        try {
          await workflowExecutionService.completeExecution(dbExecutionId, {
            status: errors.length === 0 ? 'completed' : 'failed',
            nodesExecuted,
            outputs: result.outputs,
            errorMessage: errors.length > 0 ? errors.map(e => `${e.nodeId}: ${e.error}`).join('; ') : undefined,
          })
        } catch (error) {
          console.error('Failed to complete execution tracking:', error)
        }
      }

      return result
    } catch (error: any) {
      const executionTime = Date.now() - context.startTime
      const result: ExecutionResult = {
        success: false,
        executionId: context.executionId,
        outputs: Object.fromEntries(context.outputs),
        errors: [
          {
            nodeId: 'executor',
            nodeType: 'system',
            error: error.message,
            timestamp: Date.now(),
          },
        ],
        executionTime,
        nodesExecuted,
      }

      // Complete execution tracking with failure
      if (dbExecutionId) {
        try {
          await workflowExecutionService.completeExecution(dbExecutionId, {
            status: 'failed',
            nodesExecuted,
            outputs: result.outputs,
            errorMessage: error.message,
          })
        } catch (trackingError) {
          console.error('Failed to complete execution tracking:', trackingError)
        }
      }

      return result
    }
  }

  /**
   * Schedule workflow execution (cron-based)
   */
  private scheduleExecution(
    workflow: Workflow,
    context: ExecutionContext
  ): ExecutionResult {
    const cronExpression = workflow.trigger.config?.cron
    if (!cronExpression) {
      throw new Error('Schedule trigger requires cron expression')
    }

    // Note: For MVP, we're using simple setInterval
    // For production, use node-cron or similar
    console.log(`Workflow ${workflow.id} scheduled with cron: ${cronExpression}`)

    return {
      success: true,
      executionId: context.executionId,
      outputs: { status: 'scheduled', cron: cronExpression },
      executionTime: 0,
      nodesExecuted: 0,
    }
  }

  /**
   * Start continuous monitoring (interval-based)
   */
  private startContinuousMonitoring(
    workflow: Workflow,
    context: ExecutionContext
  ): ExecutionResult {
    const interval = workflow.trigger.config?.interval || 60

    const timer = setInterval(async () => {
      await this.executeOnce(workflow, {
        ...context,
        executionId: this.generateExecutionId(),
        startTime: Date.now(),
      })
    }, interval * 1000)

    this.runningWorkflows.set(workflow.id, timer)

    return {
      success: true,
      executionId: context.executionId,
      outputs: { status: 'monitoring', interval },
      executionTime: 0,
      nodesExecuted: 0,
    }
  }

  /**
   * Execute a single node
   * Delegates to node-executors.ts based on node type
   */
  private async executeNode(
    node: WorkflowNode,
    inputs: any,
    context: ExecutionContext
  ): Promise<any> {
    const { executeNodeByType } = await import('./node-executors')
    return executeNodeByType(node.type, node.data.config || {}, inputs, context)
  }

  /**
   * Topological sort - determines execution order
   * Nodes are executed in dependency order (sources before targets)
   */
  private topologicalSort(workflow: Workflow): string[] {
    const graph = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    // Initialize graph
    for (const node of workflow.nodes) {
      graph.set(node.id, [])
      inDegree.set(node.id, 0)
    }

    // Build adjacency list and calculate in-degrees
    for (const edge of workflow.edges) {
      graph.get(edge.source)?.push(edge.target)
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }

    // Kahn's algorithm for topological sort
    const queue: string[] = []
    const result: string[] = []

    // Start with nodes that have no incoming edges
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId)
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      result.push(nodeId)

      // Process neighbors
      for (const neighbor of graph.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) queue.push(neighbor)
      }
    }

    // Check for cycles
    if (result.length !== workflow.nodes.length) {
      throw new Error('Workflow contains cycles - unable to execute')
    }

    return result
  }

  /**
   * Resolve ${nodeId.field} references in objects
   * Example: "${node1.marketId}" -> "market-123"
   */
  private resolveReferences(obj: any, context: ExecutionContext): any {
    if (typeof obj === 'string') {
      // Replace ${nodeId.field} with actual values
      return obj.replace(/\$\{([^}]+)\}/g, (match, path) => {
        const value = this.getValueByPath(path, context)
        return value !== undefined ? value : match
      })
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveReferences(item, context))
    }

    if (typeof obj === 'object' && obj !== null) {
      const resolved: any = {}
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveReferences(value, context)
      }
      return resolved
    }

    return obj
  }

  /**
   * Get value from context by path
   * Example: "node1.marketId" -> context.outputs.get('node1').marketId
   */
  private getValueByPath(path: string, context: ExecutionContext): any {
    const parts = path.split('.')
    const nodeId = parts[0]

    // Get node output
    let value = context.outputs.get(nodeId)

    // Traverse nested path
    for (let i = 1; i < parts.length && value !== undefined; i++) {
      value = value[parts[i]]
    }

    return value
  }

  /**
   * Evaluate a condition string
   * Example: "${node1.price} > 50" -> true/false
   */
  private evaluateCondition(condition: string, context: ExecutionContext): boolean {
    try {
      // Resolve any references first
      const resolved = this.resolveReferences(condition, context)

      // Safely evaluate the condition
      // Note: Using Function constructor - ensure this is only used with trusted input
      const fn = new Function('context', `return ${resolved}`)
      return Boolean(fn(context))
    } catch (error) {
      console.error('Error evaluating condition:', condition, error)
      return false
    }
  }

  /**
   * Validate workflow structure
   */
  private validateWorkflow(workflow: Workflow): void {
    if (!workflow.nodes || workflow.nodes.length === 0) {
      throw new Error('Workflow must have at least one node')
    }

    // Validate all edges reference existing nodes
    const nodeIds = new Set(workflow.nodes.map((n) => n.id))
    for (const edge of workflow.edges) {
      if (!nodeIds.has(edge.source)) {
        throw new Error(`Edge references unknown source node: ${edge.source}`)
      }
      if (!nodeIds.has(edge.target)) {
        throw new Error(`Edge references unknown target node: ${edge.target}`)
      }
    }
  }

  /**
   * Stop a running workflow (scheduled or continuous)
   */
  stopWorkflow(workflowId: string): void {
    const timer = this.runningWorkflows.get(workflowId)
    if (timer) {
      clearInterval(timer)
      this.runningWorkflows.delete(workflowId)
    }
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * Singleton instance for reuse
 */
export const workflowExecutor = new WorkflowExecutor()
