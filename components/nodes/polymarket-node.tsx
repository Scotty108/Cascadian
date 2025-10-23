'use client'

/**
 * GENERIC POLYMARKET NODE COMPONENT
 *
 * Single component that renders all Polymarket node types.
 * Reduces code duplication (200 lines vs 1000+ for separate components).
 *
 * Supported node types:
 * - polymarket-stream: Fetch market data
 * - filter: Filter by conditions
 * - llm-analysis: AI analysis with custom prompts
 * - transform: Data transformation with custom formulas
 * - condition: If/then/else logic
 * - polymarket-buy: Execute buy orders
 */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Database,
  Filter,
  Brain,
  Calculator,
  GitBranch,
  DollarSign,
  Settings,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { getStatusColor } from '@/lib/node-utils'

// ============================================================================
// NODE CONFIGURATION
// ============================================================================

const NODE_CONFIGS = {
  'polymarket-stream': {
    icon: Database,
    color: 'bg-blue-500',
    label: 'Polymarket Stream',
    description: 'Fetch market data',
  },
  filter: {
    icon: Filter,
    color: 'bg-purple-500',
    label: 'Filter',
    description: 'Filter by conditions',
  },
  'llm-analysis': {
    icon: Brain,
    color: 'bg-pink-500',
    label: 'LLM Analysis',
    description: 'AI analysis',
  },
  transform: {
    icon: Calculator,
    color: 'bg-orange-500',
    label: 'Transform',
    description: 'Data transformation',
  },
  condition: {
    icon: GitBranch,
    color: 'bg-green-500',
    label: 'Condition',
    description: 'If/then logic',
  },
  'polymarket-buy': {
    icon: DollarSign,
    color: 'bg-teal-500',
    label: 'Buy Order',
    description: 'Execute buy',
  },
}

export type PolymarketNodeData = {
  label?: string
  config?: any
  nodeType?: keyof typeof NODE_CONFIGS
  status?: 'idle' | 'running' | 'completed' | 'error'
  output?: any
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PolymarketNode({ data, selected }: NodeProps<any>) {
  const nodeType = data.nodeType || 'polymarket-stream'
  const config = NODE_CONFIGS[nodeType as keyof typeof NODE_CONFIGS]
  const status = data.status || 'idle'

  if (!config) {
    return (
      <Card className="min-w-[280px] border-2 border-red-500 bg-card p-4">
        <p className="text-sm text-red-500">Unknown node type: {nodeType}</p>
      </Card>
    )
  }

  const Icon = config.icon

  return (
    <Card className={`min-w-[280px] max-w-[400px] border-2 bg-card transition-all ${getStatusColor(status, selected)}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${config.color}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {data.label || config.label}
          </h3>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </div>
        <Settings className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Body - render based on node type */}
      <div className="p-4">
        {renderNodeBody(nodeType as keyof typeof NODE_CONFIGS, data.config, status)}
      </div>

      {/* Output section */}
      {data.output && (
        <div className="border-t border-border bg-secondary/30 p-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Output:</p>
          <div className="rounded bg-background p-2 max-h-32 overflow-y-auto">
            <p className="text-xs text-foreground whitespace-pre-wrap break-words">
              {typeof data.output === 'string'
                ? data.output
                : JSON.stringify(data.output, null, 2)}
            </p>
          </div>
        </div>
      )}

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className={`!${config.color.replace('bg-', 'bg-')}`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={`!${config.color.replace('bg-', 'bg-')}`}
      />
    </Card>
  )
}

// ============================================================================
// NODE BODY RENDERERS
// ============================================================================

function renderNodeBody(
  nodeType: keyof typeof NODE_CONFIGS,
  config: any,
  status: string
) {
  switch (nodeType) {
    case 'polymarket-stream':
      return renderPolymarketStream(config, status)
    case 'filter':
      return renderFilter(config, status)
    case 'llm-analysis':
      return renderLLMAnalysis(config, status)
    case 'transform':
      return renderTransform(config, status)
    case 'condition':
      return renderCondition(config, status)
    case 'polymarket-buy':
      return renderBuyOrder(config, status)
    default:
      return <div className="text-xs text-muted-foreground">No config</div>
  }
}

function renderPolymarketStream(config: any, status: string) {
  return (
    <div className="space-y-2">
      <div className="text-xs">
        <span className="text-muted-foreground">Categories:</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {config?.categories?.map((cat: string, i: number) => (
            <span
              key={i}
              className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            >
              {cat}
            </span>
          )) || <span className="text-xs text-muted-foreground">All</span>}
        </div>
      </div>
      {config?.minVolume && (
        <div className="text-xs">
          <span className="text-muted-foreground">Min Volume:</span>{' '}
          <span className="font-mono">${config.minVolume.toLocaleString()}</span>
        </div>
      )}
      {status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          Fetching markets...
        </div>
      )}
    </div>
  )
}

function renderFilter(config: any, status: string) {
  return (
    <div className="space-y-2">
      <div className="text-xs">
        <span className="text-muted-foreground">Conditions:</span>
        <div className="mt-1 space-y-1">
          {config?.conditions?.map((cond: any, i: number) => (
            <div
              key={i}
              className="rounded bg-secondary p-2 font-mono text-xs text-foreground"
            >
              {cond.field} {cond.operator} {JSON.stringify(cond.value)}
            </div>
          )) || <span className="text-xs text-muted-foreground">No conditions</span>}
        </div>
      </div>
      {status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          Filtering...
        </div>
      )}
    </div>
  )
}

function renderLLMAnalysis(config: any, status: string) {
  return (
    <div className="space-y-2">
      {config?.userPrompt && (
        <div className="text-xs">
          <span className="text-muted-foreground">Prompt:</span>
          <div className="mt-1 rounded bg-secondary p-2 text-xs text-foreground line-clamp-3">
            {config.userPrompt}
          </div>
        </div>
      )}
      {config?.outputFormat && (
        <div className="text-xs">
          <span className="text-muted-foreground">Output:</span>{' '}
          <span className="font-mono">{config.outputFormat}</span>
        </div>
      )}
      {status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          Analyzing with AI...
        </div>
      )}
    </div>
  )
}

function renderTransform(config: any, status: string) {
  return (
    <div className="space-y-2">
      <div className="text-xs">
        <span className="text-muted-foreground">Operations:</span>
        <div className="mt-1 space-y-1">
          {config?.operations?.map((op: any, i: number) => (
            <div key={i} className="rounded bg-secondary p-2 text-xs">
              <div className="font-medium text-foreground">{op.type}</div>
              {op.config && (
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {op.config.name && `${op.config.name} = `}
                  {op.config.formula || JSON.stringify(op.config)}
                </div>
              )}
            </div>
          )) || <span className="text-xs text-muted-foreground">No operations</span>}
        </div>
      </div>
      {status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          Transforming...
        </div>
      )}
    </div>
  )
}

function renderCondition(config: any, status: string) {
  return (
    <div className="space-y-2">
      <div className="text-xs">
        <span className="text-muted-foreground">Conditions:</span>
        <div className="mt-1 space-y-1">
          {config?.conditions?.map((cond: any, i: number) => (
            <div key={i} className="rounded bg-secondary p-2 text-xs">
              {cond.if && (
                <div className="font-mono text-foreground">
                  if: <span className="text-green-600">{cond.if}</span>
                </div>
              )}
              {cond.then && (
                <div className="mt-1 text-muted-foreground">
                  then: <span className="text-blue-600">{cond.then}</span>
                </div>
              )}
              {cond.else && (
                <div className="text-muted-foreground">
                  else: <span className="text-orange-600">{cond.else}</span>
                </div>
              )}
            </div>
          )) || <span className="text-xs text-muted-foreground">No conditions</span>}
        </div>
      </div>
      {status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          Evaluating...
        </div>
      )}
    </div>
  )
}

function renderBuyOrder(config: any, status: string) {
  return (
    <div className="space-y-2">
      {config?.outcome && (
        <div className="text-xs">
          <span className="text-muted-foreground">Outcome:</span>{' '}
          <span className="font-medium">{config.outcome}</span>
        </div>
      )}
      {config?.amount && (
        <div className="text-xs">
          <span className="text-muted-foreground">Amount:</span>{' '}
          <span className="font-mono">${config.amount}</span>
        </div>
      )}
      {config?.orderType && (
        <div className="text-xs">
          <span className="text-muted-foreground">Type:</span>{' '}
          <span className="capitalize">{config.orderType}</span>
        </div>
      )}
      {status === 'running' && (
        <div className="flex items-center gap-2 text-xs text-yellow-600">
          <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          Executing order...
        </div>
      )}
    </div>
  )
}
