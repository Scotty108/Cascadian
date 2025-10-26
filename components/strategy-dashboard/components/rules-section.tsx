'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { NodeGraph } from '@/lib/strategy-builder/types'
import {
  Database,
  Filter,
  GitMerge,
  BarChart3,
  Radio,
  Zap,
} from 'lucide-react'

interface RulesSectionProps {
  nodeGraph: NodeGraph
}

export function RulesSection({ nodeGraph }: RulesSectionProps) {
  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'DATA_SOURCE':
        return Database
      case 'FILTER':
        return Filter
      case 'LOGIC':
        return GitMerge
      case 'AGGREGATION':
        return BarChart3
      case 'SIGNAL':
        return Radio
      case 'ACTION':
        return Zap
      default:
        return Database
    }
  }

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'DATA_SOURCE':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      case 'FILTER':
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20'
      case 'LOGIC':
        return 'bg-green-500/10 text-green-600 border-green-500/20'
      case 'AGGREGATION':
        return 'bg-orange-500/10 text-orange-600 border-orange-500/20'
      case 'SIGNAL':
        return 'bg-teal-500/10 text-teal-600 border-teal-500/20'
      case 'ACTION':
        return 'bg-pink-500/10 text-pink-600 border-pink-500/20'
      default:
        return 'bg-gray-500/10 text-gray-600 border-gray-500/20'
    }
  }

  const getNodeLabel = (type: string) => {
    return type.split('_').map(word =>
      word.charAt(0) + word.slice(1).toLowerCase()
    ).join(' ')
  }

  if (!nodeGraph || nodeGraph.nodes.length === 0) {
    return (
      <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
        <CardHeader>
          <CardTitle>Strategy Workflow</CardTitle>
          <CardDescription>No nodes configured</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>This strategy doesn't have any nodes yet.</p>
            <p className="text-sm mt-2">Edit the strategy to add nodes.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{nodeGraph.nodes.length}</div>
            <div className="text-sm text-muted-foreground">Total Nodes</div>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{nodeGraph.edges.length}</div>
            <div className="text-sm text-muted-foreground">Connections</div>
          </CardContent>
        </Card>
        <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {new Set(nodeGraph.nodes.map(n => n.type)).size}
            </div>
            <div className="text-sm text-muted-foreground">Node Types</div>
          </CardContent>
        </Card>
      </div>

      {/* Node List */}
      <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
        <CardHeader>
          <CardTitle>Workflow Nodes</CardTitle>
          <CardDescription>
            The nodes that make up this strategy's logic
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {nodeGraph.nodes.map((node, index) => {
              const Icon = getNodeIcon(node.type)
              const colorClass = getNodeColor(node.type)

              return (
                <div
                  key={node.id}
                  className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition"
                >
                  {/* Step Number */}
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-sm font-semibold">
                    {index + 1}
                  </div>

                  {/* Icon */}
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg border ${colorClass}`}>
                    <Icon className="h-5 w-5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">{getNodeLabel(node.type)}</h4>
                      <Badge variant="outline" className="text-xs">
                        {node.type}
                      </Badge>
                    </div>

                    {/* Node Configuration Details */}
                    <div className="text-sm text-muted-foreground">
                      {node.type === 'DATA_SOURCE' && node.config && (
                        <span>Source: {(node.config as any).source || 'WALLETS'}</span>
                      )}
                      {node.type === 'FILTER' && node.config && (
                        <span>
                          {(node.config as any).field} {(node.config as any).operator} {JSON.stringify((node.config as any).value)}
                        </span>
                      )}
                      {node.type === 'LOGIC' && node.config && (
                        <span>Operator: {(node.config as any).operator}</span>
                      )}
                      {node.type === 'AGGREGATION' && node.config && (
                        <span>
                          {(node.config as any).function}({(node.config as any).field || 'all'})
                        </span>
                      )}
                      {node.type === 'SIGNAL' && node.config && (
                        <span>
                          {(node.config as any).signalType} - {(node.config as any).direction}
                        </span>
                      )}
                      {node.type === 'ACTION' && node.config && (
                        <span>Action: {(node.config as any).action}</span>
                      )}
                    </div>

                    {/* Connections */}
                    {nodeGraph.edges.filter(e => e.from === node.id || e.to === node.id).length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2">
                        {nodeGraph.edges.filter(e => e.from === node.id).length > 0 && (
                          <span>
                            → Connects to {nodeGraph.edges.filter(e => e.from === node.id).length} node(s)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
