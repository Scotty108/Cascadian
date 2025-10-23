"use client"

import type React from "react"
import { Code, Play, Flag, GitBranch, Globe, Database, Filter, Brain, Calculator, DollarSign, TrendingUp, Layers } from "lucide-react"
import { Card } from "@/components/ui/card"

type NodeType = {
  type: string
  label: string
  icon: React.ReactNode
  color: string
  description: string
  category?: string
}

const nodeTypes: NodeType[] = [
  // WORKFLOW CONTROL
  {
    type: "start",
    label: "Start",
    icon: <Play className="h-4 w-4" />,
    color: "bg-[#00E0AA]",
    description: "Workflow entry point",
    category: "Workflow",
  },

  // DATA SOURCES
  {
    type: "polymarket-stream",
    label: "Market Data",
    icon: <Database className="h-4 w-4" />,
    color: "bg-blue-500",
    description: "Fetch Polymarket markets",
    category: "Data Sources",
  },
  {
    type: "httpRequest",
    label: "API Request",
    icon: <Globe className="h-4 w-4" />,
    color: "bg-blue-600",
    description: "Fetch external data",
    category: "Data Sources",
  },

  // DATA PROCESSING
  {
    type: "filter",
    label: "Filter",
    icon: <Filter className="h-4 w-4" />,
    color: "bg-purple-500",
    description: "Filter by conditions",
    category: "Processing",
  },
  {
    type: "transform",
    label: "Transform",
    icon: <Calculator className="h-4 w-4" />,
    color: "bg-orange-500",
    description: "Calculate & transform data",
    category: "Processing",
  },
  {
    type: "llm-analysis",
    label: "AI Analysis",
    icon: <Brain className="h-4 w-4" />,
    color: "bg-pink-500",
    description: "Analyze with AI",
    category: "Processing",
  },

  // LOGIC & CONTROL
  {
    type: "condition",
    label: "If/Then",
    icon: <GitBranch className="h-4 w-4" />,
    color: "bg-green-500",
    description: "Conditional branching",
    category: "Logic",
  },
  {
    type: "javascript",
    label: "Custom Logic",
    icon: <Code className="h-4 w-4" />,
    color: "bg-yellow-500",
    description: "Custom JavaScript code",
    category: "Logic",
  },

  // TRADING ACTIONS
  {
    type: "polymarket-buy",
    label: "Buy Order",
    icon: <TrendingUp className="h-4 w-4" />,
    color: "bg-emerald-500",
    description: "Place buy order",
    category: "Actions",
  },

  // WORKFLOW END
  {
    type: "end",
    label: "End",
    icon: <Flag className="h-4 w-4" />,
    color: "bg-red-500",
    description: "Workflow output",
    category: "Workflow",
  },
]

type NodePaletteProps = {
  onAddNode: (type: string) => void
  onClose?: () => void
}

export function NodePalette({ onAddNode, onClose }: NodePaletteProps) {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType)
    event.dataTransfer.effectAllowed = "move"
  }

  const handleAddNode = (type: string) => {
    onAddNode(type)
    onClose?.()
  }

  return (
    <aside className="relative h-full w-80 overflow-hidden border-r border-border/40 bg-gradient-to-br from-background via-background to-background/95 md:w-64">
      {/* Gradient Overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(circle at 20% 10%, rgba(0,224,170,0.15), transparent 50%), radial-gradient(circle at 80% 90%, rgba(0,224,170,0.08), transparent 45%)",
        }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative h-full overflow-y-auto p-3 md:p-4">
        {/* Header */}
        <div className="mb-4 md:mb-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-sm">
              <TrendingUp className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-foreground md:text-base">Trading Nodes</h2>
          </div>
          <p className="text-xs text-muted-foreground">Build your trading strategy</p>
        </div>

        {/* Node Cards */}
        <div className="space-y-4">
          {(() => {
            // Group nodes by category
            const categories = ["Workflow", "Data Sources", "Processing", "Logic", "Actions"]
            let lastCategory = ""

            return nodeTypes.map((node, index) => {
              const isStartNode = node.type === "start"
              const isEndNode = node.type === "end"
              const showCategoryHeader = node.category && node.category !== lastCategory

              if (node.category) {
                lastCategory = node.category
              }

              return (
                <div key={node.type}>
                  {/* Category Header */}
                  {showCategoryHeader && (
                    <div className="mb-2 mt-4 first:mt-0">
                      <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
                        {node.category}
                      </h3>
                      <div className="mt-1 h-px bg-border/40" />
                    </div>
                  )}

                  {/* Node Card */}
                  <Card
                    draggable
                    onDragStart={(e) => onDragStart(e, node.type)}
                    onClick={() => handleAddNode(node.type)}
                    className={`group relative cursor-grab overflow-hidden rounded-2xl border transition-all active:cursor-grabbing ${
                      isStartNode
                        ? "border-[#00E0AA]/30 bg-gradient-to-br from-[#00E0AA]/5 to-background shadow-sm hover:border-[#00E0AA]/60 hover:shadow-lg hover:shadow-[#00E0AA]/10"
                        : isEndNode
                        ? "border-red-500/30 bg-gradient-to-br from-red-500/5 to-background shadow-sm hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/10"
                        : "border-border/60 bg-gradient-to-br from-secondary/80 to-secondary/40 shadow-sm hover:border-[#00E0AA]/40 hover:bg-gradient-to-br hover:from-secondary/90 hover:to-secondary/60 hover:shadow-md"
                    }`}
                  >
                    <div className="relative p-2.5 md:p-3">
                      <div className="flex items-center gap-2.5 md:gap-3">
                        {/* Icon Badge */}
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-105 md:h-10 md:w-10 ${
                            isStartNode
                              ? "bg-[#00E0AA] shadow-[#00E0AA]/20"
                              : node.color
                          }`}
                        >
                          <div className={`${isStartNode ? "text-slate-950" : "text-primary-foreground"}`}>
                            {node.icon}
                          </div>
                        </div>

                        {/* Node Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className={`text-xs font-semibold tracking-tight md:text-sm ${
                            isStartNode ? "text-[#00E0AA]" : isEndNode ? "text-red-500" : "text-foreground"
                          }`}>
                            {node.label}
                          </h3>
                          <p className="hidden truncate text-xs text-muted-foreground md:block">
                            {node.description}
                          </p>
                          {/* Mobile description */}
                          <p className="truncate text-xs text-muted-foreground md:hidden">
                            {node.description}
                          </p>
                        </div>

                        {/* Hover indicator */}
                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100 ${
                          isStartNode ? "bg-[#00E0AA]" : isEndNode ? "bg-red-500" : "bg-[#00E0AA]"
                        }`} />
                      </div>
                    </div>
                  </Card>
                </div>
              )
            })
          })()}
        </div>

        {/* Bottom Gradient Fade */}
        <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
      </div>
    </aside>
  )
}
