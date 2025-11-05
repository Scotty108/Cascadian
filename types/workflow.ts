/**
 * WORKFLOW TYPE DEFINITIONS
 *
 * All TypeScript types for the AI-powered workflow system.
 * Supports both existing nodes and new Polymarket trading nodes.
 */

// ============================================================================
// WORKFLOW STRUCTURE
// ============================================================================

export interface Workflow {
  id: string
  name: string
  description?: string
  trigger: WorkflowTrigger
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  variables?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'continuous' | 'webhook'
  config?: {
    cron?: string              // "0 * * * *" for hourly
    webhook_url?: string
    interval?: number          // seconds for continuous
  }
}

export interface WorkflowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: NodeData
  condition?: string           // Optional conditional execution
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
}

// ============================================================================
// NODE TYPES
// ============================================================================

/**
 * All supported node types
 * - Existing: start, end, javascript, httpRequest, conditional
 * - New Polymarket: polymarket-stream, filter, llm-analysis, transform, condition, polymarket-buy
 */
export type NodeType =
  // Existing nodes (keep compatibility)
  | 'start'
  | 'end'
  | 'javascript'
  | 'httpRequest'
  | 'conditional'
  // New Polymarket nodes (MVP)
  | 'polymarket-stream'
  | 'filter'
  | 'llm-analysis'
  | 'transform'
  | 'condition'
  | 'polymarket-buy'
  // Future nodes (post-MVP)
  | 'llm-research'
  | 'polymarket-sell'
  | 'add-to-watchlist'
  | 'monitor-momentum'
  | 'wallet-intelligence'
  | 'notification'
  | 'loop'
  | 'delay'
  | 'orchestrator'
  | 'DATA_SOURCE'
  | 'WALLET_FILTER'
  | 'MARKET_FILTER'
  | 'SMART_MONEY_SIGNAL'

export interface NodeData {
  label?: string
  config?: any                 // Node-specific configuration
  inputs?: Record<string, any>
  outputs?: string[]
  status?: 'idle' | 'running' | 'completed' | 'error'
  output?: any
  // For Polymarket nodes, include nodeType for generic component
  nodeType?: NodeType
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

export interface ExecutionContext {
  workflowId: string
  executionId: string
  startTime: number
  outputs: Map<string, any>          // Store outputs by node ID
  globalState: Record<string, any>   // Shared state across nodes
  watchlists: Map<string, WatchlistState>
  variables: Record<string, any>     // User-defined variables
}

export interface ExecutionResult {
  success: boolean
  executionId: string
  outputs: Record<string, any>
  errors?: ExecutionError[]
  executionTime: number
  nodesExecuted: number
}

export interface ExecutionError {
  nodeId: string
  nodeType: string
  error: string
  timestamp: number
}

// ============================================================================
// NODE-SPECIFIC CONFIGURATION TYPES
// ============================================================================

/**
 * Polymarket Stream Node
 * Fetches market data from Polymarket
 */
export interface PolymarketStreamConfig {
  categories?: string[]        // ['Politics', 'Crypto', 'Sports']
  minVolume?: number
  maxResults?: number
  active?: boolean             // Only active markets
}

/**
 * Filter Node
 * Filters data based on conditions
 */
export interface FilterConfig {
  conditions: FilterCondition[]
}

export interface FilterCondition {
  field: string                    // e.g., 'volume', 'category', 'endsAt'
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: any
}

/**
 * LLM Analysis Node
 * Runs AI analysis with custom prompts
 */
export interface LLMAnalysisConfig {
  model?: string                   // 'claude-sonnet-4-5', 'gpt-4', etc.
  systemPrompt?: string
  userPrompt: string               // ANY custom prompt
  temperature?: number
  maxTokens?: number
  outputFormat?: 'text' | 'json' | 'boolean' | 'number'
}

/**
 * LLM Research Node (post-MVP)
 * LLM with research tools
 */
export interface LLMResearchConfig extends LLMAnalysisConfig {
  tools?: string[]                 // ['web_search', 'news_api', 'perplexity']
}

/**
 * Transform Node
 * Data transformation with custom formulas
 */
export interface TransformConfig {
  operations: TransformOperation[]
}

export interface TransformOperation {
  type: 'add-column' | 'filter-rows' | 'aggregate' | 'sort' | 'join'
  config: any                      // e.g., { name: 'edge', formula: 'aiProbability - currentPrice' }
}

/**
 * Condition Node
 * If/then/else logic (enhanced version of conditional)
 */
export interface ConditionConfig {
  conditions: ConditionBranch[]
}

export interface ConditionBranch {
  if?: string                      // Expression to evaluate
  and?: string | string[]          // Additional conditions
  then: string                     // Target node ID or action
  else?: string                    // Else target node ID
}

/**
 * Polymarket Buy Node
 * Execute buy orders
 */
export interface PolymarketBuyConfig {
  marketId?: string                // Can use ${nodeId.marketId} reference
  outcome?: string                 // 'Yes' or 'No'
  amount?: number                  // Amount in USD
  orderType?: 'market' | 'limit'
  limitPrice?: number
  slippage?: number                // Max slippage percentage
}

/**
 * Polymarket Sell Node (post-MVP)
 */
export interface PolymarketSellConfig extends PolymarketBuyConfig {
  // Same as buy config
}

/**
 * Watchlist Node (post-MVP)
 * Add markets to monitoring
 */
export interface WatchlistConfig {
  marketId: string
  conditions: MonitorCondition[]
  checkInterval: number            // seconds
}

export interface MonitorCondition {
  trigger: string                  // e.g., "momentum > 0.05"
  action: 'buy' | 'sell' | 'notify' | 'remove'
  removeAfterTrigger?: boolean
}

export interface WatchlistState {
  id: string
  marketId: string
  conditions: MonitorCondition[]
  checkInterval: number
  createdAt: number
  lastChecked?: number
  status: 'active' | 'triggered' | 'expired'
  unsubscribe?: () => void
}

// ============================================================================
// POLYMARKET DATA TYPES
// ============================================================================

export interface PolymarketMarket {
  id: string
  question: string
  description: string
  category: string
  endsAt: Date
  currentPrice: number
  volume: number
  liquidity: number
  outcomes: string[]
  rules?: string
  conditionId?: string
  active?: boolean
  closed?: boolean
}

export interface TradeOrder {
  marketId: string
  outcome: string
  amount: number
  side: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  limitPrice?: number
  slippage?: number
}

export interface TradeResult {
  orderId: string
  marketId: string
  executedPrice: number
  amount: number
  status: 'filled' | 'partial' | 'cancelled' | 'pending'
  timestamp: number
}

// ============================================================================
// AI CONVERSATION TYPES
// ============================================================================

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  suggestions?: string[]
  toolCalls?: ToolCall[]
  timestamp?: number
}

export interface ToolCall {
  function: {
    name: string
    arguments: any
  }
}

export interface ConversationalBuildRequest {
  messages: ConversationMessage[]
  currentWorkflow: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
  }
}

export interface ConversationalBuildResponse {
  message: string
  toolCalls?: ToolCall[]
  suggestions?: string[]
  workflowComplete?: boolean
  nodeCount?: number
  passCount?: number
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Node configuration by type
 * Maps node types to their config interfaces
 */
export type NodeConfig<T extends NodeType> =
  T extends 'polymarket-stream' ? PolymarketStreamConfig :
  T extends 'filter' ? FilterConfig :
  T extends 'llm-analysis' ? LLMAnalysisConfig :
  T extends 'llm-research' ? LLMResearchConfig :
  T extends 'transform' ? TransformConfig :
  T extends 'condition' ? ConditionConfig :
  T extends 'polymarket-buy' ? PolymarketBuyConfig :
  T extends 'polymarket-sell' ? PolymarketSellConfig :
  T extends 'add-to-watchlist' ? WatchlistConfig :
  any // Fallback for existing nodes

/**
 * Type guard for node data
 */
export function isPolymarketNode(type: NodeType): boolean {
  return [
    'polymarket-stream',
    'filter',
    'llm-analysis',
    'llm-research',
    'transform',
    'condition',
    'polymarket-buy',
    'polymarket-sell',
    'add-to-watchlist',
    'monitor-momentum',
    'wallet-intelligence',
  ].includes(type)
}

/**
 * Type guard for executable nodes
 */
export function isExecutableNode(type: NodeType): boolean {
  return type !== 'start' && type !== 'end'
}
