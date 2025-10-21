"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Code2, ArrowRight, GitBranch, PlayCircle, StopCircle, Globe } from "lucide-react"

// Mock workflow nodes for the default template
const workflowNodes = [
  {
    id: "1",
    type: "start",
    label: "Start",
    description: "Workflow entry point",
    icon: PlayCircle,
    config: {},
  },
  {
    id: "2",
    type: "httpRequest",
    label: "Get Market Data",
    description: "Fetch markets from Polymarket API",
    icon: Globe,
    config: {
      url: "https://api.polymarket.com/markets",
      method: "GET",
    },
  },
  {
    id: "3",
    type: "conditional",
    label: "Check SII",
    description: "Filter high SII markets",
    icon: GitBranch,
    config: {
      condition: "input1.sii > 60",
    },
  },
  {
    id: "4",
    type: "javascript",
    label: "Buy Signal",
    description: "Generate buy action for high SII markets",
    icon: Code2,
    config: {
      code: "// High SII market found\nreturn { action: 'BUY', market: input1 }",
    },
  },
  {
    id: "5",
    type: "javascript",
    label: "Skip Market",
    description: "Skip low SII markets",
    icon: Code2,
    config: {
      code: "// Low SII - skip\nreturn { action: 'SKIP' }",
    },
  },
  {
    id: "6",
    type: "end",
    label: "End",
    description: "Workflow completion",
    icon: StopCircle,
    config: {},
  },
]

const connections = [
  { from: "1", to: "2", label: "" },
  { from: "2", to: "3", label: "" },
  { from: "3", to: "4", label: "✓ HIGH SII", condition: true },
  { from: "3", to: "5", label: "✗ LOW SII", condition: false },
  { from: "4", to: "6", label: "" },
  { from: "5", to: "6", label: "" },
]

const getNodeColor = (type: string) => {
  switch (type) {
    case "start":
      return "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800"
    case "end":
      return "bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800"
    case "conditional":
      return "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-800"
    case "httpRequest":
      return "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800"
    case "javascript":
      return "bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800"
    default:
      return "bg-gray-100 dark:bg-gray-900/20 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-800"
  }
}

export function RulesSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Strategy Workflow</CardTitle>
          <CardDescription>
            Visual representation of the strategy's execution rules and logic flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {workflowNodes.map((node, index) => {
              const Icon = node.icon
              const nodeColor = getNodeColor(node.type)
              const nextConnection = connections.find(c => c.from === node.id)
              const branchConnections = connections.filter(c => c.from === node.id)

              return (
                <div key={node.id}>
                  {/* Node Card */}
                  <div className={`border-2 rounded-lg p-4 ${nodeColor}`}>
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-md bg-background/50">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold">{node.label}</h4>
                          <Badge variant="outline" className="text-xs">
                            {node.type}
                          </Badge>
                        </div>
                        <p className="text-sm opacity-90 mb-2">{node.description}</p>

                        {/* Configuration */}
                        {Object.keys(node.config).length > 0 && (
                          <div className="mt-3 p-2 rounded bg-background/30 text-xs font-mono">
                            {node.type === "httpRequest" && (
                              <div className="space-y-1">
                                <div><span className="opacity-60">Method:</span> {node.config.method}</div>
                                <div><span className="opacity-60">URL:</span> {node.config.url}</div>
                              </div>
                            )}
                            {node.type === "conditional" && (
                              <div><span className="opacity-60">Condition:</span> {node.config.condition}</div>
                            )}
                            {node.type === "javascript" && (
                              <pre className="whitespace-pre-wrap">{node.config.code}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Connection Arrow(s) */}
                  {branchConnections.length > 0 && index < workflowNodes.length - 1 && (
                    <div className="flex items-center justify-center py-2">
                      {branchConnections.length === 1 ? (
                        <div className="flex flex-col items-center">
                          <ArrowRight className="h-5 w-5 text-muted-foreground rotate-90" />
                          {nextConnection?.label && (
                            <span className="text-xs text-muted-foreground mt-1">
                              {nextConnection.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-8 w-full max-w-md">
                          {branchConnections.map((conn) => (
                            <div key={`${conn.from}-${conn.to}`} className="flex flex-col items-center">
                              <ArrowRight className={`h-5 w-5 rotate-90 ${conn.condition ? 'text-green-600' : 'text-red-600'}`} />
                              {conn.label && (
                                <span className={`text-xs mt-1 ${conn.condition ? 'text-green-600' : 'text-red-600'}`}>
                                  {conn.label}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{workflowNodes.length}</div>
              <div className="text-sm text-muted-foreground">Total Nodes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{connections.length}</div>
              <div className="text-sm text-muted-foreground">Connections</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {workflowNodes.filter(n => n.type === "conditional").length}
              </div>
              <div className="text-sm text-muted-foreground">Decision Points</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
