"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Code2, Globe, GitBranch, PlayCircle, StopCircle } from "lucide-react"

import { ACCENT_COLOR } from "../utils"

const workflowNodes = [
  {
    id: "1",
    type: "start",
    label: "Start",
    description: "Cascadian orchestration listens for strategy activation",
    icon: PlayCircle,
    config: {},
  },
  {
    id: "2",
    type: "httpRequest",
    label: "Get Market Data",
    description: "Fetch current Polymarket orderbooks and metadata",
    icon: Globe,
    config: {
      method: "GET",
      url: "https://api.polymarket.com/markets",
    },
  },
  {
    id: "3",
    type: "conditional",
    label: "Check SII",
    description: "Route only markets with sentiment influence index greater than 60",
    icon: GitBranch,
    config: {
      condition: "input1.sii > 60",
    },
  },
  {
    id: "4",
    type: "javascript",
    label: "Buy Signal",
    description: "Emit structured buy orders with guardrails applied",
    icon: Code2,
    config: {
      code: "// High SII market detected\nreturn { action: 'BUY', market: input1 }",
    },
  },
  {
    id: "5",
    type: "javascript",
    label: "Skip Market",
    description: "Graceful skip for markets that fail thresholds",
    icon: Code2,
    config: {
      code: "// SII too low, do not trade\nreturn { action: 'SKIP' }",
    },
  },
  {
    id: "6",
    type: "end",
    label: "End",
    description: "Finalize cycle and await next polling interval",
    icon: StopCircle,
    config: {},
  },
] as const

const connections = [
  { from: "1", to: "2", label: "Initialize", condition: undefined },
  { from: "2", to: "3", label: "Markets enriched", condition: undefined },
  { from: "3", to: "4", label: "✓ Impact > 60", condition: true },
  { from: "3", to: "5", label: "✗ Impact ≤ 60", condition: false },
  { from: "4", to: "6", label: "Buy order emitted", condition: undefined },
  { from: "5", to: "6", label: "Skip logged", condition: undefined },
] as const

const palette = {
  start: {
    background: `${ACCENT_COLOR}12`,
    text: ACCENT_COLOR,
    border: `${ACCENT_COLOR}33`,
  },
  end: {
    background: "rgba(168, 85, 247, 0.14)",
    text: "#a855f7",
    border: "rgba(168, 85, 247, 0.35)",
  },
  conditional: {
    background: "rgba(245, 158, 11, 0.12)",
    text: "#f59e0b",
    border: "rgba(245, 158, 11, 0.35)",
  },
  httpRequest: {
    background: "rgba(59, 130, 246, 0.12)",
    text: "#3b82f6",
    border: "rgba(59, 130, 246, 0.35)",
  },
  javascript: {
    background: "rgba(129, 140, 248, 0.12)",
    text: "#818cf8",
    border: "rgba(129, 140, 248, 0.35)",
  },
  default: {
    background: "rgba(148, 163, 184, 0.12)",
    text: "#94a3b8",
    border: "rgba(148, 163, 184, 0.35)",
  },
} as const

const getPalette = (type: string) => {
  switch (type) {
    case "start":
      return palette.start
    case "end":
      return palette.end
    case "conditional":
      return palette.conditional
    case "httpRequest":
      return palette.httpRequest
    case "javascript":
      return palette.javascript
    default:
      return palette.default
  }
}

export function RulesSection() {
  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
        <CardHeader className="border-b border-border/60 pb-6">
          <CardTitle className="text-lg font-semibold">Automation flow</CardTitle>
          <CardDescription>
            Step-by-step view of the default Cascadian strategy template
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="relative pl-6">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border/50" aria-hidden />

            <div className="space-y-6">
              {workflowNodes.map(node => {
                const Icon = node.icon
                const paletteToken = getPalette(node.type)
                const downstream = connections.filter(conn => conn.from === node.id)
                const isBranch = downstream.length > 1

                return (
                  <div key={node.id} className="relative">
                    <span
                      className="absolute -left-[38px] top-6 h-3 w-3 rounded-full border-2 border-background shadow"
                      style={{
                        backgroundColor: paletteToken.background,
                        borderColor: paletteToken.border,
                        boxShadow: `0 0 0 4px ${paletteToken.background}`,
                      }}
                    />

                    <div
                      className="rounded-2xl border p-4 shadow-sm backdrop-blur transition hover:shadow-lg"
                      style={{
                        backgroundColor: paletteToken.background,
                        borderColor: paletteToken.border,
                      }}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <span
                            className="flex h-11 w-11 items-center justify-center rounded-xl border bg-background/80"
                            style={{ borderColor: paletteToken.border, color: paletteToken.text }}
                          >
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-base font-semibold leading-snug text-foreground">
                                {node.label}
                              </h4>
                              <Badge
                                variant="outline"
                                className="rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide"
                                style={{
                                  borderColor: paletteToken.border,
                                  color: paletteToken.text,
                                }}
                              >
                                {node.type}
                              </Badge>
                            </div>
                            <p className="max-w-2xl text-sm text-muted-foreground">{node.description}</p>
                          </div>
                        </div>

                        {Object.keys(node.config).length > 0 && (
                          <div className="min-w-[220px] rounded-xl border border-border/60 bg-background/70 p-3 text-xs font-mono leading-relaxed text-muted-foreground">
                            {node.type === "httpRequest" && (
                              <div className="space-y-2">
                                <div>
                                  <span className="opacity-60">Method:</span> {node.config.method}
                                </div>
                                <div className="break-all">
                                  <span className="opacity-60">URL:</span> {node.config.url}
                                </div>
                              </div>
                            )}
                            {node.type === "conditional" && (
                              <div>
                                <span className="opacity-60">Condition:</span> {node.config.condition}
                              </div>
                            )}
                            {node.type === "javascript" && (
                              <pre className="whitespace-pre-wrap">{node.config.code}</pre>
                            )}
                          </div>
                        )}
                      </div>

                      {downstream.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                          {downstream.map(conn => (
                            <span
                              key={`${conn.from}-${conn.to}`}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full border px-3 py-1",
                                conn.condition === undefined
                                  ? "border-border/60 text-muted-foreground"
                                  : conn.condition
                                    ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
                                    : "border-[#f97316]/40 bg-[#f97316]/10 text-[#f97316]"
                              )}
                            >
                              {conn.label || "Next"}
                            </span>
                          ))}
                          {!isBranch && downstream.length === 1 && (
                            <span className="text-xs text-muted-foreground">
                              Continues to #{downstream[0].to}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
        <CardHeader className="border-b border-border/60 pb-6">
          <CardTitle className="text-lg font-semibold">Workflow summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-background/70 p-4 text-center">
            <div className="text-3xl font-semibold">{workflowNodes.length}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Nodes orchestrated</div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/70 p-4 text-center">
            <div className="text-3xl font-semibold">{connections.length}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Connections</div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/70 p-4 text-center">
            <div className="text-3xl font-semibold">
              {workflowNodes.filter(node => node.type === "conditional").length}
            </div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Decision forks</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
