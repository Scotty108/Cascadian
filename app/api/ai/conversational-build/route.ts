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
  ]

  if (batchIndicators.some((indicator) => lowerMessage.includes(indicator))) {
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
  const MAX_PASSES = 10

  let aiResponse = ''
  let isComplete = false

  const systemPrompt = buildBatchSystemPrompt()

  while (!isComplete && passCount < MAX_PASSES) {
    passCount++
    console.log(`Building pass ${passCount}...`)

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-10).map((m: any) => ({ role: m.role, content: m.content })),
          {
            role: 'system',
            content: `Progress: ${allToolCalls.length} actions completed. Current workflow: ${workflowInProgress.nodes?.length || 0} nodes. Continue building if needed.`,
          },
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
      const isDone =
        finishReason === 'stop' ||
        aiResponse.toLowerCase().includes('workflow is complete') ||
        aiResponse.toLowerCase().includes('all nodes added') ||
        aiResponse.toLowerCase().includes("i've built") ||
        !choice.message.tool_calls ||
        choice.message.tool_calls.length === 0

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
    // Add Polymarket Stream node
    addPolymarketStreamNode: {
      description: 'Add a Polymarket data source node to fetch market data',
      parameters: z.object({
        categories: z
          .array(z.string())
          .describe('Market categories to fetch (Politics, Crypto, Sports, etc.)'),
        minVolume: z.number().describe('Minimum trading volume filter'),
        id: z.string().optional().describe('Optional custom node ID'),
        label: z.string().optional().describe('Optional custom label'),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Filter node
    addFilterNode: {
      description: 'Add a filter node to filter data by conditions',
      parameters: z.object({
        conditions: z.array(
          z.object({
            field: z.string().describe('Field to filter on (e.g., volume, category, price)'),
            operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
            value: z.union([z.string(), z.number(), z.boolean()]).describe('Value to compare against'),
          })
        ).describe('Conditions to filter by'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add LLM Analysis node
    addLLMNode: {
      description: 'Add an LLM analysis node with ANY custom prompt',
      parameters: z.object({
        userPrompt: z.string().describe('ANY custom prompt - e.g., "Does this relate to Batman?"'),
        model: z.string().optional().describe('AI model (default: gemini-1.5-flash)'),
        outputFormat: z
          .enum(['text', 'json', 'boolean', 'number'])
          .optional()
          .describe('Expected output format (default: text)'),
        systemPrompt: z.string().optional().describe('Optional system prompt for context'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Transform node
    addTransformNode: {
      description: 'Add a data transformation node with ANY custom formula',
      parameters: z.object({
        operations: z.array(
          z.object({
            type: z.enum(['add-column', 'filter-rows', 'sort']),
            config: z
              .record(z.any())
              .describe(
                'For add-column: {name: string, formula: string}. Formula can be ANY math expression like "currentPrice - 0.5"'
              ),
          })
        ).describe('Transformation operations to apply'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Condition node
    addConditionNode: {
      description: 'Add an if/then/else logic node',
      parameters: z.object({
        conditions: z.array(
          z.object({
            if: z.string().describe('Condition to evaluate (e.g., "price > 0.5")'),
            then: z.string().describe('Action/path if true'),
            else: z.string().optional().describe('Action/path if false'),
          })
        ).describe('Conditional logic rules'),
        id: z.string().optional(),
        label: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    },

    // Add Buy node
    addBuyNode: {
      description: 'Add a Polymarket buy order node',
      parameters: z.object({
        outcome: z.enum(['Yes', 'No']).describe('Which outcome to buy'),
        amount: z.number().describe('Amount in USD to invest'),
        orderType: z.enum(['market', 'limit']).optional().describe('Order type (default: market)'),
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
    addPolymarketStreamNode: 'polymarket-stream',
    addFilterNode: 'filter',
    addLLMNode: 'llm-analysis',
    addTransformNode: 'transform',
    addConditionNode: 'condition',
    addBuyNode: 'polymarket-buy',
    addTransactionNode: 'polymarket-buy',  // Map transaction to buy node
  }

  const nodeType = mapping[toolName]
  if (!nodeType) {
    console.warn(`⚠️ Unknown tool name: ${toolName}, defaulting to 'filter'`)
    return 'filter'  // Default to filter instead of unknown
  }

  return nodeType
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

function buildBatchSystemPrompt(): string {
  return `You are building a COMPLETE Polymarket trading bot workflow.

🚨 CRITICAL RULES:
1. Create SIMPLE, FOCUSED workflows (4-6 nodes maximum!)
2. For EVERY node, IMMEDIATELY call connectNodes to connect it
3. ONE data source node (not 10+)
4. Keep it clean and efficient

SIMPLE WORKFLOW PATTERN (4-5 nodes):
\`\`\`
addPolymarketStreamNode({categories: ["Crypto"], minVolume: 10000})
addFilterNode({conditions: [{field: "volume", operator: "gt", value: 50000}]})
connectNodes({sourceId: "polymarket-stream-...", targetId: "filter-..."})
addLLMNode({userPrompt: "Is this market undervalued?"})
connectNodes({sourceId: "filter-...", targetId: "llm-analysis-..."})
addBuyNode({outcome: "Yes", amount: 100})
connectNodes({sourceId: "llm-analysis-...", targetId: "polymarket-buy-..."})
\`\`\`

❌ DON'T DO THIS:
- Creating 10+ nodes (too complex!)
- Multiple data source nodes (use ONE)
- Forgetting to connect nodes
- Complex branching (keep it simple)

✅ DO THIS:
- 1 data source → 1 filter → 1 analysis → 1 action
- Total: 4-5 nodes maximum
- Every node connected
- Clean, linear workflow

Available nodes:
- polymarket-stream: Fetch markets (USE ONCE!)
- filter: Filter by conditions
- llm-analysis: AI analysis
- transform: Data transformation
- condition: If/then logic
- polymarket-buy: Execute buy

BUILD A SIMPLE, FOCUSED BOT NOW!`
}

function buildIncrementalSystemPrompt(workflow: any): string {
  const nodeCount = workflow.nodes?.length || 0

  return `You are a Polymarket trading bot builder assistant.

Current workflow: ${nodeCount} nodes

You can add nodes with custom prompts and formulas:
- LLM nodes: ANY prompt (e.g., "Does this relate to Batman?")
- Transform nodes: ANY formula (e.g., "edge = currentPrice - 0.5")

IMPORTANT: When adding new nodes, ALWAYS connect them to existing nodes using connectNodes!
A node without connections doesn't do anything.

You can also modify existing workflows:
- updateNode: Change node configuration
- deleteNode: Remove a node
- connectNodes: Add new connections

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

  let summary = `✅ **Workflow Complete!**\n\n📊 Summary:\n- Nodes: ${nodeCount}\n- Connections: ${edgeCount}\n- Actions: ${toolCalls.length}\n\n`

  if (nodeTypes) {
    summary += `📦 Created:\n`
    for (const [type, count] of Object.entries(nodeTypes)) {
      summary += `- ${type}: ${count}\n`
    }
  }

  return summary
}

function generateSuggestions(workflow: any, toolCalls: any[]): string[] {
  if (!toolCalls || toolCalls.length === 0) {
    return ['Add data source', 'Add filter', 'Add LLM analysis']
  }

  const lastTool = toolCalls[toolCalls.length - 1]?.toolName

  if (lastTool === 'addPolymarketStreamNode') {
    return ['Add filter', 'Add LLM analysis', 'Add transform']
  }

  if (lastTool === 'addFilterNode') {
    return ['Add LLM analysis', 'Add transform', 'Add another filter']
  }

  if (lastTool === 'addLLMNode') {
    return ['Add condition', 'Add transform', 'Add buy action']
  }

  return ['Add more nodes', 'Test workflow', 'Modify existing nodes']
}
