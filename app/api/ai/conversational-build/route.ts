/**
 * CONVERSATIONAL WORKFLOW BUILDER API
 *
 * Handles conversational workflow building with AI using Vercel AI SDK.
 *
 * Features:
 * - Iterative conversation (one node at a time)
 * - Batch building (entire workflow from long prompt)
 * - Function calling with Zod schemas
 * - Multi-pass execution for unlimited complexity
 * - Modify existing workflows (updateNode, deleteNode, reconnect)
 *
 * Uses GPT-4-Turbo via native OpenAI SDK
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import type { Node, Edge } from '@xyflow/react'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export const maxDuration = 60 // Allow up to 60s for complex batch builds

// ============================================================================
// REQUEST TYPES
// ============================================================================

interface ConversationalBuildRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  currentWorkflow: {
    nodes: Node[]
    edges: Edge[]
  }
}

// ============================================================================
// MAIN ROUTE HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const { messages, currentWorkflow }: ConversationalBuildRequest = await req.json()

    const lastMessage = messages[messages.length - 1]?.content || ''
    const isBatchRequest = detectBatchRequest(lastMessage)

    if (isBatchRequest) {
      // Build entire workflow in one go
      return await buildWorkflowComplete(messages, currentWorkflow)
    } else {
      // Iterative building (one node at a time)
      return await buildWorkflowIncremental(messages, currentWorkflow)
    }
  } catch (error: any) {
    console.error('Conversational build error:', error)
    return NextResponse.json(
      {
        message: 'Sorry, I encountered an error. Please try again.',
        error: error.message,
      },
      { status: 500 }
    )
  }
}

// ============================================================================
// BATCH REQUEST DETECTION
// ============================================================================

/**
 * Detect if user wants entire workflow built at once
 */
function detectBatchRequest(message: string): boolean {
  const lowerMessage = message.toLowerCase()

  const batchIndicators = [
    'build me a bot',
    'build a bot',
    'create a workflow',
    'build a complete',
    'build everything',
    'full workflow',
    'entire bot',
    'complete bot',
    'start to finish',
    'build me a strategy',
    'create a strategy',
    'strategy:',           // Detects "Strategy 11: ..."
    'goal:',               // Detects "Goal: ..."
    'filters:',            // Detects "Filters: ..."
    'methodology:',        // Detects "Methodology: ..."
    'sort by:',            // Detects "Sort By: ..."
  ]

  if (batchIndicators.some((indicator) => lowerMessage.includes(indicator))) {
    return true
  }

  // Detect if message has multiple filters listed
  const filterCount = (message.match(/filter|must|should|top \d+%|< \d+|> \d+/gi) || []).length
  if (filterCount > 2) {
    return true
  }

  // Detect "find/get wallets with X and Y" pattern (multiple conditions)
  const hasMultipleConditions =
    (lowerMessage.includes('find') || lowerMessage.includes('get')) &&
    lowerMessage.includes('wallets') &&
    lowerMessage.includes(' and ') &&
    (lowerMessage.includes('>') || lowerMessage.includes('<') || lowerMessage.includes('top '))

  if (hasMultipleConditions) {
    return true
  }

  // Count steps described (then, next, after, finally, etc.)
  const steps = message.split(/then|and then|next|after that|finally|also/).length
  return steps > 3
}

// ============================================================================
// BATCH BUILDING (Complete Workflow)
// ============================================================================

async function buildWorkflowComplete(
  messages: any[],
  currentWorkflow: any
): Promise<Response> {
  const allToolCalls: any[] = []
  let workflowInProgress = {
    ...currentWorkflow,
    nodes: currentWorkflow.nodes || [],
    edges: currentWorkflow.edges || [],
  }
  let passCount = 0
  const MAX_PASSES = 2  // Reduced from 10 - AI should build complete workflow in 1-2 passes

  let aiResponse = ''
  let isComplete = false

  const systemPrompt = buildBatchSystemPrompt()

  while (!isComplete && passCount < MAX_PASSES) {
    passCount++
    console.log(`[Batch Build] Pass ${passCount}/${MAX_PASSES}...`)

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-10).map((m: any) => ({ role: m.role, content: m.content })),
          ...(passCount > 1 ? [{
            role: 'system' as const,
            content: `You've already created ${workflowInProgress.nodes?.length || 0} nodes. Only add more if absolutely necessary to complete the strategy.`,
          }] : []),
        ],
        tools: convertToolsForOpenAI(getTools()),
        tool_choice: 'auto',
      })

      const choice = completion.choices[0]
      aiResponse = choice.message.content || ''
      const finishReason = choice.finish_reason

      // Apply tool calls
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        console.log(`Pass ${passCount}: ${choice.message.tool_calls.length} tool calls`)

        for (const toolCall of choice.message.tool_calls) {
          // Type guard for function tool calls
          if (toolCall.type !== 'function') continue

          const args = JSON.parse(toolCall.function.arguments)

          // Store for response
          allToolCalls.push({
            function: { name: toolCall.function.name, arguments: args },
          })

          // Apply to workflow
          workflowInProgress = applyToolCallToWorkflow(workflowInProgress, {
            toolName: toolCall.function.name,
            args,
          })
        }
      }

      // Check if done
      const createdNodesThisPass = choice.message.tool_calls?.length || 0
      const isDone =
        finishReason === 'stop' ||
        aiResponse.toLowerCase().includes('workflow is complete') ||
        aiResponse.toLowerCase().includes('all nodes added') ||
        aiResponse.toLowerCase().includes("i've built") ||
        aiResponse.toLowerCase().includes('done') ||
        !choice.message.tool_calls ||
        choice.message.tool_calls.length === 0 ||
        createdNodesThisPass >= 3  // If 3+ nodes created, workflow is likely complete

      console.log(`[Batch Build] Pass ${passCount} complete: ${createdNodesThisPass} tool calls, isDone=${isDone}`)

      if (isDone) isComplete = true
    } catch (error: any) {
      console.error(`Error in pass ${passCount}:`, error)
      break
    }
  }

  // AUTO-CONNECT FALLBACK: If AI didn't create enough edges, auto-connect nodes sequentially
  const nodeCount = workflowInProgress.nodes?.length || 0
  const edgeCount = workflowInProgress.edges?.length || 0
  const expectedEdges = Math.max(0, nodeCount - 1)  // N nodes should have N-1 edges minimum

  if (nodeCount > 1 && edgeCount < expectedEdges) {
    console.log(`⚠️ AI created ${nodeCount} nodes but only ${edgeCount}/${expectedEdges} edges! Auto-connecting...`)

    // Build a set of existing connections to avoid duplicates
    const existingConnections = new Set(
      (workflowInProgress.edges || []).map((e: any) => `${e.source}->${e.target}`)
    )

    const autoEdges = [...(workflowInProgress.edges || [])]
    for (let i = 0; i < workflowInProgress.nodes.length - 1; i++) {
      const sourceNode = workflowInProgress.nodes[i]
      const targetNode = workflowInProgress.nodes[i + 1]
      const connectionKey = `${sourceNode.id}->${targetNode.id}`

      // Only add if this connection doesn't already exist
      if (!existingConnections.has(connectionKey)) {
        autoEdges.push({
          id: `edge-auto-${i}`,
          source: sourceNode.id,
          target: targetNode.id,
          label: 'auto',
        })

        // Add to toolCalls for UI display
        allToolCalls.push({
          function: {
            name: 'connectNodes',
            arguments: {
              sourceId: sourceNode.id,
              targetId: targetNode.id,
              label: 'auto-connected',
            },
          },
        })
      }
    }

    workflowInProgress.edges = autoEdges
    console.log(`✅ Auto-connected to ${autoEdges.length} total edges (added ${autoEdges.length - edgeCount} new)`)
  }

  const summary = generateWorkflowSummary(workflowInProgress, allToolCalls)

  return NextResponse.json({
    message: `${aiResponse}\n\n${summary}`,
    toolCalls: allToolCalls,
    suggestions: ['Test workflow', 'Make adjustments', 'Explain how it works'],
    workflowComplete: isComplete,
    nodeCount: workflowInProgress.nodes?.length || 0,
    passCount,
  })
}

// ============================================================================
// INCREMENTAL BUILDING (One Step at a Time)
// ============================================================================

async function buildWorkflowIncremental(
  messages: any[],
  currentWorkflow: any
): Promise<Response> {
  const systemPrompt = buildIncrementalSystemPrompt(currentWorkflow)

  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map((m: any) => ({ role: m.role, content: m.content })),
    ],
    tools: convertToolsForOpenAI(getTools()),
    tool_choice: 'auto',
  })

  const choice = completion.choices[0]
  const text = choice.message.content || ''
  const rawToolCalls = choice.message.tool_calls || []

  const toolCalls = rawToolCalls
    .filter((tc) => tc.type === 'function')
    .map((tc) => ({
      function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments) },
    }))

  const suggestions = generateSuggestions(currentWorkflow, rawToolCalls)

  return NextResponse.json({
    message: text,
    toolCalls,
    suggestions,
  })
}

// ============================================================================
// TOOL DEFINITIONS (Zod Schemas)
// ============================================================================

function getTools() {
  return {
    // Add Data Source node
    addDataSourceNode: {
      description: 'Add a data source node to fetch wallet or market data from the database',
      parameters: z.object({
        source: z.enum(['WALLETS', 'MARKETS', 'TRADES', 'SIGNALS', 'CATEGORIES']).describe('Type of data to fetch'),
        table: z.string().optional().describe('Specific table name (e.g., wallet_metrics_complete)'),
        mode: z.enum(['BATCH', 'REALTIME']).optional().describe('Data fetch mode (default: BATCH)'),
        filters: z.record(z.any()).optional().describe('Pre-filters to apply when fetching data'),
        id: z.string().optional().describe('Optional custom node ID'),
        label: z.string().optional().describe('Optional custom label'),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Filter node
    addFilterNode: {
      description: 'Add a filter node to filter data by conditions (omega_ratio, net_pnl, win_rate, etc.)',
      parameters: z.object({
        field: z.string().describe('Field to filter on (omega_ratio, net_pnl, win_rate, total_volume, etc.)'),
        operator: z.enum(['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL', 'IN', 'NOT_IN', 'BETWEEN', 'IN_PERCENTILE']).describe('Comparison operator'),
        value: z.any().describe('Value to compare against'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Logic node
    addLogicNode: {
      description: 'Add a logic node to combine multiple conditions (AND/OR/NOT/XOR)',
      parameters: z.object({
        operator: z.enum(['AND', 'OR', 'NOT', 'XOR']).describe('Logical operator to apply'),
        inputs: z.array(z.string()).optional().describe('Input node IDs to combine'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Aggregation node
    addAggregationNode: {
      description: 'Add an aggregation node to calculate metrics (COUNT/SUM/AVG/MIN/MAX/PERCENTILE)',
      parameters: z.object({
        function: z.enum(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'PERCENTILE']).describe('Aggregation function'),
        field: z.string().optional().describe('Field to aggregate (for SUM/AVG/MIN/MAX/PERCENTILE)'),
        groupBy: z.array(z.string()).optional().describe('Fields to group by'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Signal node
    addSignalNode: {
      description: 'Add a signal node to generate trading signals (ENTRY/EXIT/HOLD)',
      parameters: z.object({
        signalType: z.enum(['ENTRY', 'EXIT', 'HOLD']).describe('Type of signal to generate'),
        direction: z.enum(['YES', 'NO']).optional().describe('Direction for ENTRY/EXIT signals'),
        strength: z.enum(['VERY_WEAK', 'WEAK', 'MODERATE', 'STRONG', 'VERY_STRONG']).optional().describe('Signal strength'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Action node
    addActionNode: {
      description: 'Add an action node to execute actions (ADD_TO_WATCHLIST/SEND_ALERT/WEBHOOK/LOG_RESULT)',
      parameters: z.object({
        action: z.enum(['ADD_TO_WATCHLIST', 'SEND_ALERT', 'WEBHOOK', 'LOG_RESULT']).describe('Action to execute'),
        params: z.record(z.any()).optional().describe('Action-specific parameters'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Connect nodes
    connectNodes: {
      description: 'Connect two nodes with an edge',
      parameters: z.object({
        sourceId: z.string().describe('ID of source node'),
        targetId: z.string().describe('ID of target node'),
        label: z.string().optional().describe('Optional label for the edge'),
      }),
    },

    // Update existing node
    updateNode: {
      description: 'Update configuration of an existing node',
      parameters: z.object({
        nodeId: z.string().describe('ID of node to update'),
        updates: z.record(z.any()).describe('Configuration updates to apply'),
      }),
    },

    // Delete node
    deleteNode: {
      description: 'Delete a node from the workflow',
      parameters: z.object({
        nodeId: z.string().describe('ID of node to delete'),
      }),
    },
  }
}

/**
 * Convert Zod tools to OpenAI function calling format
 */
function convertToolsForOpenAI(zodTools: ReturnType<typeof getTools>) {
  return Object.entries(zodTools).map(([name, tool]) => {
    const jsonSchema = zodToJsonSchema(tool.parameters)
    // Remove the $schema property that zodToJsonSchema adds
    const { $schema, ...params } = jsonSchema as any
    return {
      type: 'function' as const,
      function: {
        name,
        description: tool.description,
        parameters: params,
      },
    }
  })
}

// ============================================================================
// TOOL CALL APPLICATION
// ============================================================================

function applyToolCallToWorkflow(workflow: any, toolCall: any): any {
  const { toolName, args } = toolCall
  const nodes = workflow.nodes || []
  const edges = workflow.edges || []

  // Node creation tools
  if (toolName.includes('Node') && toolName.startsWith('add')) {
    const newNode = createNode(toolName, args, nodes.length)
    return { ...workflow, nodes: [...nodes, newNode] }
  }

  // Connect nodes
  if (toolName === 'connectNodes') {
    const newEdge = {
      id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      source: args.sourceId,
      target: args.targetId,
      label: args.label,
    }
    return { ...workflow, edges: [...edges, newEdge] }
  }

  // Update node
  if (toolName === 'updateNode') {
    const updatedNodes = nodes.map((node: any) =>
      node.id === args.nodeId
        ? { ...node, data: { ...node.data, config: { ...node.data.config, ...args.updates } } }
        : node
    )
    return { ...workflow, nodes: updatedNodes }
  }

  // Delete node
  if (toolName === 'deleteNode') {
    const filteredNodes = nodes.filter((n: any) => n.id !== args.nodeId)
    const filteredEdges = edges.filter(
      (e: any) => e.source !== args.nodeId && e.target !== args.nodeId
    )
    return { ...workflow, nodes: filteredNodes, edges: filteredEdges }
  }

  return workflow
}

// Unique ID generator - uses timestamp + counter for guaranteed uniqueness
let nodeIdCounter = 0
function createNode(toolName: string, args: any, nodeCount: number): Node {
  const nodeType = getNodeTypeFromTool(toolName)

  // ALWAYS generate unique ID - never trust AI-provided IDs
  // Use timestamp + incrementing counter for guaranteed uniqueness
  const timestamp = Date.now()
  const uniqueId = `${nodeType}-${timestamp}-${++nodeIdCounter}`

  console.log(`[Workflow Builder] Creating node: ${uniqueId}`)

  // Auto-layout: stagger nodes horizontally
  const position = args.position || {
    x: nodeCount * 300 + 100,
    y: 200 + (nodeCount % 2) * 100,
  }

  // Extract config (remove id, position, label)
  const { id: _id, position: _pos, label, ...config } = args

  return {
    id: uniqueId,
    type: nodeType,
    position,
    data: {
      label: label || nodeType,
      config,
      nodeType, // For generic component
    },
  }
}

function getNodeTypeFromTool(toolName: string): string {
  const mapping: Record<string, string> = {
    addDataSourceNode: 'DATA_SOURCE',
    addFilterNode: 'FILTER',
    addLogicNode: 'LOGIC',
    addAggregationNode: 'AGGREGATION',
    addSignalNode: 'SIGNAL',
    addActionNode: 'ACTION',
  }

  const nodeType = mapping[toolName]
  if (!nodeType) {
    console.warn(`⚠️ Unknown tool name: ${toolName}, defaulting to 'FILTER'`)
    return 'FILTER'  // Default to FILTER instead of unknown
  }

  return nodeType
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

function buildBatchSystemPrompt(): string {
  return `You are building a COMPLETE wallet screening strategy for CASCADIAN.

🎯 YOUR JOB:
Parse the user's strategy description and build ALL necessary nodes to implement it.

📋 STRATEGY PARSING GUIDE:
1. **Filters** (look for "Filter:", "Must", "Should", "Top X%", ">", "<", "="):
   - Each filter condition → ONE FILTER node
   - Field names: brier_score, omega_ratio, net_pnl, win_rate, crowd_orthogonality, yes_no_bias, etc.
   - Operators: GREATER_THAN, LESS_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN_OR_EQUAL, IN_PERCENTILE

2. **Combining Filters** (if multiple filters):
   - Create a LOGIC node with operator "AND" to combine them

3. **Sorting** (look for "Sort by", "Rank by", "Order by"):
   - Create an AGGREGATION node with function "MIN" or "MAX"
   - Set the field to the metric mentioned (e.g., crowd_orthogonality)

4. **Action** (look for "Add to", "Alert", "Notify", "Execute"):
   - Create an ACTION node with appropriate action type
   - Common actions: ADD_TO_WATCHLIST, SEND_ALERT, WEBHOOK, LOG_RESULT

🏗️ WORKFLOW PATTERN FOR STRATEGIES:

⚠️ CRITICAL: DO NOT call connectNodes() - the system auto-connects nodes sequentially!
Just create nodes in the correct order and they will be connected automatically.

\`\`\`
SIMPLE EXAMPLE: "Find wallets with omega > 1.5 and win rate > 60%, add to watchlist"

CORRECT TOOL CALLS (in one response):
1. addDataSourceNode({ source: 'WALLETS', table: 'wallet_metrics_complete', mode: 'BATCH' })
2. addFilterNode({ field: 'omega_ratio', operator: 'GREATER_THAN', value: 1.5 })
3. addFilterNode({ field: 'win_rate', operator: 'GREATER_THAN', value: 0.6 })
4. addLogicNode({ operator: 'AND' })
5. addActionNode({ action: 'ADD_TO_WATCHLIST' })

TOTAL: 5 nodes, auto-connected in sequence. DONE!
\`\`\`

📊 AVAILABLE METRICS (102 total):

**Core Performance:**
- omega_ratio, sortino_ratio, calmar_ratio
- net_pnl, total_pnl, roi
- win_rate, closed_positions

**Risk Metrics:**
- max_drawdown, avg_drawdown
- cvar_95, cvar_99
- sharpe_ratio, kelly_utilization

**Activity Metrics:**
- bets_per_week, avg_bet_size
- total_volume, track_record_days

**Advanced Metrics:**
- brier_score (#25) - forecasting accuracy
- crowd_orthogonality (#68) - independence from crowd
- yes_no_bias (#98) - directional bias
- edge_source_decomposition (#102) - where P&L comes from
- omega_lag_30s (#48) - lag-adjusted omega

🚨 CRITICAL RULES:
1. ⚠️ DO NOT call connectNodes() - connections are automatic!
2. ⚠️ BUILD COMPLETE STRATEGY IN ONE RESPONSE - all nodes at once!
3. ⚠️ NO DUPLICATES - each condition = ONE filter node only!
4. Parse the ENTIRE user message - extract all filters, sorting, and actions
5. Use realistic field names from the 102 metrics above
6. Keep workflows simple: DATA_SOURCE → FILTERS → LOGIC → ACTION
7. ONE data source node per workflow
8. For percentages like "60%", convert to decimal 0.6

✅ EXAMPLE 1: "Find wallets with omega > 2 and win rate > 60%, sort by PnL"

CORRECT RESPONSE (call ALL tools in ONE response):
1. addDataSourceNode({source: 'WALLETS', table: 'wallet_metrics_complete', mode: 'BATCH'})
2. addFilterNode({field: 'omega_ratio', operator: 'GREATER_THAN', value: 2})
3. addFilterNode({field: 'win_rate', operator: 'GREATER_THAN', value: 0.6})
4. addLogicNode({operator: 'AND'})
5. addAggregationNode({function: 'MAX', field: 'net_pnl'})
6. addActionNode({action: 'ADD_TO_WATCHLIST', params: {list_name: 'High Performers'}})

TOTAL: 6 nodes. DONE in ONE pass!

✅ EXAMPLE 2: "Find high omega wallets and add to watchlist"

CORRECT RESPONSE:
1. addDataSourceNode({source: 'WALLETS', table: 'wallet_metrics_complete', mode: 'BATCH'})
2. addFilterNode({field: 'omega_ratio', operator: 'GREATER_THAN', value: 1.5})
3. addActionNode({action: 'ADD_TO_WATCHLIST'})

TOTAL: 3 nodes. DONE!

NOW BUILD THE COMPLETE STRATEGY FROM THE USER'S DESCRIPTION IN ONE RESPONSE!`
}

function buildIncrementalSystemPrompt(workflow: any): string {
  const nodeCount = workflow.nodes?.length || 0

  return `You are a wallet screening and trading strategy builder assistant.

Current workflow: ${nodeCount} nodes

Available node types:
- DATA_SOURCE: Fetch wallets, markets, trades, signals, or categories from database
- FILTER: Filter data by conditions (omega_ratio, net_pnl, win_rate, total_volume, etc.)
- LOGIC: Combine multiple conditions with AND/OR/NOT/XOR operators
- AGGREGATION: Calculate metrics like COUNT, SUM, AVG, MIN, MAX, PERCENTILE
- SIGNAL: Generate trading signals (ENTRY/EXIT/HOLD) with direction and strength
- ACTION: Execute actions like ADD_TO_WATCHLIST, SEND_ALERT, WEBHOOK, LOG_RESULT

IMPORTANT: When adding new nodes, ALWAYS connect them to existing nodes using connectNodes!
A node without connections doesn't do anything.

You can also modify existing workflows:
- updateNode: Change node configuration
- deleteNode: Remove a node
- connectNodes: Add new connections

Common fields for wallet screening:
- omega_ratio: Risk-adjusted returns metric
- net_pnl: Net profit/loss
- win_rate: Percentage of winning trades
- total_volume: Total trading volume
- avg_position_size: Average position size
- sharpe_ratio: Risk-adjusted performance metric

Be conversational. Ask questions. Build incrementally.`
}

// ============================================================================
// HELPERS
// ============================================================================

function generateWorkflowSummary(workflow: any, toolCalls: any[]): string {
  const nodeCount = workflow.nodes?.length || 0
  const edgeCount = workflow.edges?.length || 0

  const nodeTypes = workflow.nodes?.reduce((acc: any, node: any) => {
    acc[node.type] = (acc[node.type] || 0) + 1
    return acc
  }, {})

  let summary = `✅ **Strategy Built Successfully!**\n\n`

  // Count node types
  const dataSourceCount = nodeTypes?.DATA_SOURCE || 0
  const filterCount = nodeTypes?.FILTER || 0
  const logicCount = nodeTypes?.LOGIC || 0
  const aggregationCount = nodeTypes?.AGGREGATION || 0
  const signalCount = nodeTypes?.SIGNAL || 0
  const actionCount = nodeTypes?.ACTION || 0

  summary += `📦 **Nodes Created (${nodeCount} total):**\n`

  if (dataSourceCount > 0) {
    summary += `1. **Data Source** - Fetch wallets from database\n`
  }

  if (filterCount > 0) {
    summary += `${filterCount > 1 ? `2-${filterCount + 1}. **Filters (${filterCount})** - ` : '2. **Filter** - '}`

    // Try to extract filter details from tool calls
    const filterCalls = toolCalls.filter((tc: any) => tc.function?.name === 'addFilterNode')
    if (filterCalls.length > 0) {
      const filterDescriptions = filterCalls.map((fc: any) => {
        const args = fc.function.arguments
        return `${args.field} ${args.operator} ${JSON.stringify(args.value)}`
      }).join(', ')
      summary += `${filterDescriptions}\n`
    } else {
      summary += 'Applied screening criteria\n'
    }
  }

  if (logicCount > 0) {
    const logicCalls = toolCalls.filter((tc: any) => tc.function?.name === 'addLogicNode')
    const operator = logicCalls[0]?.function?.arguments?.operator || 'AND'
    summary += `${filterCount + 2}. **Logic (${operator})** - Combine all filters\n`
  }

  if (aggregationCount > 0) {
    const aggCalls = toolCalls.filter((tc: any) => tc.function?.name === 'addAggregationNode')
    const aggFunction = aggCalls[0]?.function?.arguments?.function || 'SORT'
    const aggField = aggCalls[0]?.function?.arguments?.field || 'results'
    summary += `${filterCount + logicCount + 2}. **Aggregation** - ${aggFunction} by ${aggField}\n`
  }

  if (signalCount > 0) {
    summary += `${nodeCount - actionCount}. **Signal** - Generate trading signals\n`
  }

  if (actionCount > 0) {
    const actionCalls = toolCalls.filter((tc: any) => tc.function?.name === 'addActionNode')
    const actionType = actionCalls[0]?.function?.arguments?.action || 'EXECUTE'
    const actionParams = actionCalls[0]?.function?.arguments?.params
    const listName = actionParams?.list_name || 'watchlist'
    summary += `${nodeCount}. **Action** - ${actionType.replace('_', ' ')}${actionParams ? ` (${listName})` : ''}\n`
  }

  summary += `\n🔗 **Connections:** ${edgeCount} edges created\n\n`

  summary += `This workflow implements a complete screening strategy. You can now test it or make adjustments!`

  return summary
}

function generateSuggestions(workflow: any, toolCalls: any[]): string[] {
  if (!toolCalls || toolCalls.length === 0) {
    return ['Add data source', 'Add filter', 'Add aggregation']
  }

  const lastTool = toolCalls[toolCalls.length - 1]?.toolName

  if (lastTool === 'addDataSourceNode') {
    return ['Add filter', 'Add logic node', 'Add aggregation']
  }

  if (lastTool === 'addFilterNode') {
    return ['Add aggregation', 'Add logic node', 'Add another filter']
  }

  if (lastTool === 'addLogicNode') {
    return ['Add signal', 'Add aggregation', 'Add action']
  }

  if (lastTool === 'addAggregationNode') {
    return ['Add signal', 'Add action', 'Add filter']
  }

  if (lastTool === 'addSignalNode') {
    return ['Add action', 'Explain strategy', 'Test workflow']
  }

  return ['Add more nodes', 'Test workflow', 'Modify existing nodes']
}
