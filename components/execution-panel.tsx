"use client"

import { useState } from "react"
import type { Node, Edge } from "@xyflow/react"
import { Play, X, CheckCircle, XCircle, Loader2, Terminal, FileCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

type ExecutionResult = {
  nodeId: string
  type: string
  output: any
  error?: string
}

type ExecutionPanelProps = {
  nodes: Node[]
  edges: Edge[]
  onClose: () => void
  onNodeStatusChange?: (nodeId: string, status: "idle" | "running" | "completed" | "error") => void
  onNodeOutputChange?: (nodeId: string, output: any) => void
}

export function ExecutionPanel({ nodes, edges, onClose, onNodeStatusChange, onNodeOutputChange }: ExecutionPanelProps) {
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionLog, setExecutionLog] = useState<ExecutionResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)

  const handleExecute = async () => {
    setIsExecuting(true)
    setExecutionLog([])
    setError(null)
    setCurrentNodeId(null)

    nodes.forEach((node) => {
      if (onNodeStatusChange) onNodeStatusChange(node.id, "idle")
      if (onNodeOutputChange) onNodeOutputChange(node.id, null)
    })

    try {
      const response = await fetch("/api/execute-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      })

      if (!response.body) {
        throw new Error("No response body")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const update = JSON.parse(line)

            switch (update.type) {
              case "node_start":
                if (onNodeStatusChange && update.nodeId) {
                  onNodeStatusChange(update.nodeId, "running")
                  setCurrentNodeId(update.nodeId)
                }
                break

              case "node_complete":
                if (update.nodeId) {
                  if (onNodeStatusChange) {
                    onNodeStatusChange(update.nodeId, "completed")
                  }
                  if (onNodeOutputChange) {
                    onNodeOutputChange(update.nodeId, update.output)
                  }
                  const node = nodes.find((n) => n.id === update.nodeId)
                  setExecutionLog((prev) => [
                    ...prev,
                    {
                      nodeId: update.nodeId,
                      type: node?.type || "unknown",
                      output: update.output,
                    },
                  ])
                  setCurrentNodeId(null)
                }
                break

              case "node_error":
                if (update.nodeId && onNodeStatusChange) {
                  onNodeStatusChange(update.nodeId, "error")
                }
                const errorNode = nodes.find((n) => n.id === update.nodeId)
                setExecutionLog((prev) => [
                  ...prev,
                  {
                    nodeId: update.nodeId || "unknown",
                    type: errorNode?.type || "unknown",
                    output: null,
                    error: update.error,
                  },
                ])
                setCurrentNodeId(null)
                break

              case "complete":
                setCurrentNodeId(null)
                break

              case "error":
                setError(update.error || "Execution failed")
                break
            }
          } catch (parseError) {
            console.error("Failed to parse update:", parseError)
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to execute workflow")
    } finally {
      setIsExecuting(false)
    }
  }

  const getNodeLabel = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return nodeId

    switch (node.type) {
      case "textModel":
        return `Text Model (${node.data.model})`
      case "embeddingModel":
        return `Embedding Model (${node.data.model})`
      case "tool":
        return `Tool (${node.data.name})`
      case "structuredOutput":
        return `Structured Output (${node.data.schemaName})`
      case "prompt":
        return "Prompt"
      case "imageGeneration":
        return "Image Generation"
      case "audio":
        return "Audio Generation"
      case "javascript":
        return "JavaScript"
      case "httpRequest":
        return "HTTP Request"
      case "conditional":
        return "Conditional"
      case "start":
        return "Start"
      case "end":
        return "End"
      default:
        return node.type || "Unknown"
    }
  }

  return (
    <aside className="absolute right-0 top-0 z-10 h-full w-full overflow-hidden border-l border-border/40 bg-gradient-to-br from-background via-background to-background/95 md:relative md:w-96">
      {/* Gradient Overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(circle at 90% 10%, rgba(0,224,170,0.15), transparent 50%), radial-gradient(circle at 80% 90%, rgba(0,224,170,0.08), transparent 45%)",
        }}
        aria-hidden="true"
      />

      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-border/40 px-4 py-4 md:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-sm">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-foreground">Execution</h2>
            <p className="text-xs text-muted-foreground">Strategy execution log</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="rounded-xl transition hover:bg-[#00E0AA]/10 hover:text-[#00E0AA]"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="relative h-[calc(100%-73px)] overflow-y-auto p-4 md:p-5">
        {/* Execute Button */}
        <Button
          data-execute-workflow
          onClick={handleExecute}
          disabled={isExecuting || nodes.length === 0}
          className="w-full gap-2 rounded-xl bg-[#00E0AA] text-slate-950 shadow-lg shadow-[#00E0AA]/20 transition hover:bg-[#00E0AA]/90 disabled:opacity-50"
        >
          {isExecuting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run Workflow
            </>
          )}
        </Button>

        {/* Error Display */}
        {error && (
          <Card className="mt-4 overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-500/10 to-red-500/5 shadow-sm">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-500/20 shadow-sm">
                  <XCircle className="h-4 w-4 text-red-500" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-semibold text-red-500">Execution Error</p>
                  <p className="text-xs leading-relaxed text-red-500/90">{error}</p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Running Node Display */}
        {currentNodeId && (
          <div className="mt-4">
            <div className="mb-3 flex items-center gap-2">
              <FileCode className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold tracking-tight text-foreground">Execution Log</h3>
            </div>
            <Card className="overflow-hidden rounded-2xl border border-[#00E0AA]/30 bg-gradient-to-br from-[#00E0AA]/10 to-[#00E0AA]/5 shadow-sm">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#00E0AA]/20 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-[#00E0AA]" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-semibold text-[#00E0AA]">{getNodeLabel(currentNodeId)}</p>
                    <p className="text-xs text-muted-foreground">Processing...</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Execution Log */}
        {executionLog.length > 0 && (
          <div className="mt-4">
            {!currentNodeId && (
              <div className="mb-3 flex items-center gap-2">
                <FileCode className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold tracking-tight text-foreground">Execution Log</h3>
              </div>
            )}
            <ScrollArea className="h-[calc(100vh-300px)]">
              <div className="space-y-3 pr-4">
                {executionLog.map((result, index) => {
                  const isError = !!result.error
                  const isSuccess = !isError

                  return (
                    <Card
                      key={index}
                      className={`overflow-hidden rounded-2xl border shadow-sm transition-all ${
                        isError
                          ? "border-red-500/40 bg-gradient-to-br from-red-500/10 to-red-500/5"
                          : "border-[#00E0AA]/30 bg-gradient-to-br from-[#00E0AA]/5 to-background"
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Status Icon */}
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${
                              isError ? "bg-red-500/20" : "bg-[#00E0AA]/20"
                            }`}
                          >
                            {isError ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-[#00E0AA]" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 space-y-2">
                            <p
                              className={`text-sm font-semibold ${
                                isError ? "text-red-500" : "text-[#00E0AA]"
                              }`}
                            >
                              {getNodeLabel(result.nodeId)}
                            </p>

                            {/* Error Message */}
                            {isError && (
                              <p className="text-xs leading-relaxed text-red-500/90">{result.error}</p>
                            )}

                            {/* Success Output */}
                            {isSuccess && result.output !== null && (
                              <div className="overflow-hidden rounded-xl border border-border/50 bg-background/80 shadow-sm">
                                <div className="p-3">
                                  <pre className="max-h-40 overflow-auto text-xs leading-relaxed text-muted-foreground">
                                    {typeof result.output === "string"
                                      ? result.output
                                      : JSON.stringify(result.output, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Empty State */}
        {executionLog.length === 0 && !error && !isExecuting && !currentNodeId && (
          <Card className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-secondary/80 to-secondary/40 shadow-sm">
            <div className="p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00E0AA]/10 shadow-sm">
                <Terminal className="h-6 w-6 text-[#00E0AA]" />
              </div>
              <p className="text-sm font-medium text-foreground">Ready to Execute</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click &quot;Run Workflow&quot; to execute your strategy pipeline
              </p>
            </div>
          </Card>
        )}

        {/* Bottom Gradient Fade */}
        <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
      </div>
    </aside>
  )
}
