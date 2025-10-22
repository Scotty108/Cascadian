"use client"

import type React from "react"
import { MessageSquare, Layers, Wrench, FileText, ImageIcon, Code, Play, Flag, GitBranch, Globe } from "lucide-react"
import { Card } from "@/components/ui/card"

type NodeType = {
  type: string
  label: string
  icon: React.ReactNode
  color: string
  description: string
}

const nodeTypes: NodeType[] = [
  {
    type: "start",
    label: "Start",
    icon: <Play className="h-4 w-4" />,
    color: "bg-[#00E0AA]",
    description: "Workflow entry point",
  },
  {
    type: "prompt",
    label: "Prompt",
    icon: <FileText className="h-4 w-4" />,
    color: "bg-chart-5",
    description: "Input text or prompt",
  },
  {
    type: "textModel",
    label: "Text Model",
    icon: <MessageSquare className="h-4 w-4" />,
    color: "bg-primary",
    description: "Generate text with LLM",
  },
  {
    type: "imageGeneration",
    label: "Image Generation",
    icon: <ImageIcon className="h-4 w-4" />,
    color: "bg-chart-1",
    description: "Generate images",
  },
  {
    type: "httpRequest",
    label: "HTTP Request",
    icon: <Globe className="h-4 w-4" />,
    color: "bg-blue-500",
    description: "Call external APIs",
  },
  {
    type: "conditional",
    label: "Conditional",
    icon: <GitBranch className="h-4 w-4" />,
    color: "bg-purple-500",
    description: "Branch based on condition",
  },
  {
    type: "javascript",
    label: "JavaScript",
    icon: <Code className="h-4 w-4" />,
    color: "bg-yellow-500",
    description: "Execute custom JS code",
  },
  {
    type: "embeddingModel",
    label: "Embedding Model",
    icon: <Layers className="h-4 w-4" />,
    color: "bg-chart-2",
    description: "Convert text to embeddings",
  },
  {
    type: "tool",
    label: "Tool",
    icon: <Wrench className="h-4 w-4" />,
    color: "bg-chart-4",
    description: "Custom function tool",
  },
  {
    type: "end",
    label: "End",
    icon: <Flag className="h-4 w-4" />,
    color: "bg-red-500",
    description: "Workflow output",
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
              <Layers className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-foreground md:text-base">Node Palette</h2>
          </div>
          <p className="text-xs text-muted-foreground">Drag or click to add nodes</p>
        </div>

        {/* Node Cards */}
        <div className="space-y-2.5">
          {nodeTypes.map((node) => {
            // Special styling for Start node with brand color
            const isStartNode = node.type === "start"
            const isEndNode = node.type === "end"

            return (
              <Card
                key={node.type}
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
            )
          })}
        </div>

        {/* Bottom Gradient Fade */}
        <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
      </div>
    </aside>
  )
}
