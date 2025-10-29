"use client"

import type { Node } from "@xyflow/react"
import { X, Trash2, ChevronDown, ChevronUp, Table as TableIcon, Code } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useState } from "react"
import EnhancedFilterConfigPanel from "@/components/strategy-builder/enhanced-filter-node/enhanced-filter-config-panel"
import OrchestratorConfigPanel from "@/components/strategy-builder/orchestrator-node/orchestrator-config-panel"
import type { EnhancedFilterConfig, OrchestratorConfig } from "@/lib/strategy-builder/types"

type NodeConfigPanelProps = {
  node: Node | null
  onClose: () => void
  onUpdate: (nodeId: string, data: any) => void
  onDelete?: (nodeId: string) => void
}

export function NodeConfigPanel({ node, onClose, onUpdate, onDelete }: NodeConfigPanelProps) {
  const [showPreview, setShowPreview] = useState(true)

  if (!node) return null

  // Special handling for Enhanced Filter - use dedicated panel
  if (node.type === "ENHANCED_FILTER") {
    return (
      <EnhancedFilterConfigPanel
        nodeId={node.id}
        config={node.data.config as EnhancedFilterConfig}
        onSave={onUpdate}
        onClose={onClose}
      />
    )
  }

  // Special handling for Orchestrator - use dedicated panel
  if (node.type === "ORCHESTRATOR") {
    return (
      <OrchestratorConfigPanel
        nodeId={node.id}
        config={node.data.config as OrchestratorConfig}
        onSave={onUpdate}
        onClose={onClose}
      />
    )
  }

  const handleUpdate = (field: string, value: any) => {
    onUpdate(node.id, { ...node.data, [field]: value })
  }

  const getSampleData = () => {
    switch (node.type) {
      case "polymarket-stream":
        return [
          { id: "16084", question: "Will Trump win 2024?", volume: 25000000, category: "Politics", endDate: "2024-11-05" },
          { id: "16085", question: "Bitcoin above $100k in 2024?", volume: 12000000, category: "Crypto", endDate: "2024-12-31" },
          { id: "16086", question: "Lakers win NBA title?", volume: 8500000, category: "Sports", endDate: "2025-06-30" },
        ]
      case "filter":
        return [
          { id: "16084", question: "Will Trump win 2024?", volume: 25000000, passed: true },
          { id: "16085", question: "Bitcoin above $100k in 2024?", volume: 12000000, passed: true },
        ]
      case "llm-analysis":
        return [
          { id: "16084", question: "Will Trump win 2024?", analysis: "Based on current polling data...", sentiment: "bullish", confidence: 0.75 },
          { id: "16085", question: "Bitcoin above $100k in 2024?", analysis: "Market momentum suggests...", sentiment: "bearish", confidence: 0.62 },
        ]
      case "transform":
        return [
          { id: "16084", question: "Will Trump win 2024?", volume: 25000000, roi: 0.15, profitability: "high" },
          { id: "16085", question: "Bitcoin above $100k in 2024?", volume: 12000000, roi: 0.08, profitability: "medium" },
        ]
      case "condition":
        return [
          { id: "16084", question: "Will Trump win 2024?", condition_met: true, action: "buy" },
          { id: "16085", question: "Bitcoin above $100k in 2024?", condition_met: false, action: "skip" },
        ]
      case "polymarket-buy":
        return [
          { id: "16084", question: "Will Trump win 2024?", outcome: "YES", amount: 100, orderType: "market", status: "pending" },
        ]
      case "httpRequest":
        return [
          { status: 200, data: { markets: 150, totalVolume: 45000000 } },
        ]
      case "javascript":
        return [
          { output: "Processed result", computedValue: 42, timestamp: new Date().toISOString() },
        ]
      case "start":
        return [
          { status: "initialized", timestamp: new Date().toISOString() },
        ]
      case "end":
        return [
          { status: "completed", results: 3, timestamp: new Date().toISOString() },
        ]
      default:
        return [{ status: "no preview available" }]
    }
  }

  const sampleData = getSampleData()
  const sampleKeys = sampleData.length > 0 ? Object.keys(sampleData[0]) : []

  const renderConfig = () => {
    switch (node.type) {
      case "DATA_SOURCE":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="source">Data Source</Label>
              <Select
                value={((node.data.config as any)?.source as string) || "WALLETS"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  source: value
                })}
              >
                <SelectTrigger id="source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WALLETS">Wallets</SelectItem>
                  <SelectItem value="MARKETS">Markets</SelectItem>
                  <SelectItem value="TRADES">Trades</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mode">Mode</Label>
              <Select
                value={((node.data.config as any)?.mode as string) || "BATCH"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  mode: value
                })}
              >
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BATCH">Batch</SelectItem>
                  <SelectItem value="STREAM">Stream</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="table">Table</Label>
              <Input
                id="table"
                value={((node.data.config as any)?.prefilters?.table as string) || "wallet_metrics_complete"}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  prefilters: {
                    ...((node.data.config as any)?.prefilters || {}),
                    table: e.target.value
                  }
                })}
                placeholder="wallet_metrics_complete"
              />
            </div>

            {/* Wallet Filtering Section */}
            {((node.data.config as any)?.source === "WALLETS") && (
              <>
                <div className="pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold mb-3">Wallet Filters</h3>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category Filter</Label>
                  <Select
                    value={((node.data.config as any)?.filters?.category as string) || "all"}
                    onValueChange={(value) => handleUpdate("config", {
                      ...(node.data.config || {}),
                      filters: {
                        ...((node.data.config as any)?.filters || {}),
                        category: value === "all" ? null : value
                      }
                    })}
                  >
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="politics">Politics</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="sports">Sports</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="entertainment">Entertainment</SelectItem>
                      <SelectItem value="science">Science</SelectItem>
                      <SelectItem value="pop-culture">Pop Culture</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Filter by primary_category column
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="minOmega">Minimum Omega</Label>
                  <Input
                    id="minOmega"
                    type="number"
                    step="0.1"
                    value={((node.data.config as any)?.filters?.min_omega as number) || ""}
                    onChange={(e) => handleUpdate("config", {
                      ...(node.data.config || {}),
                      filters: {
                        ...((node.data.config as any)?.filters || {}),
                        min_omega: e.target.value ? Number(e.target.value) : undefined
                      }
                    })}
                    placeholder="1.5"
                  />
                  <p className="text-xs text-muted-foreground">
                    Filter wallets by omega ratio
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="minTrades30d">Minimum Trades (30 days)</Label>
                  <Input
                    id="minTrades30d"
                    type="number"
                    value={((node.data.config as any)?.filters?.min_trades_30d as number) || ""}
                    onChange={(e) => handleUpdate("config", {
                      ...(node.data.config || {}),
                      filters: {
                        ...((node.data.config as any)?.filters || {}),
                        min_trades_30d: e.target.value ? Number(e.target.value) : undefined
                      }
                    })}
                    placeholder="10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Filter by trades_30d column
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orderBy">Sort By</Label>
                  <Select
                    value={((node.data.config as any)?.orderBy as string) || "omega DESC"}
                    onValueChange={(value) => handleUpdate("config", {
                      ...(node.data.config || {}),
                      orderBy: value
                    })}
                  >
                    <SelectTrigger id="orderBy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="omega DESC">Omega (Highest First)</SelectItem>
                      <SelectItem value="pnl_30d DESC">PnL 30d (Highest First)</SelectItem>
                      <SelectItem value="sharpe_30d DESC">Sharpe 30d (Highest First)</SelectItem>
                      <SelectItem value="win_rate_30d DESC">Win Rate 30d (Highest First)</SelectItem>
                      <SelectItem value="trades_30d DESC">Trades 30d (Most Active)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Order results by metric
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="limit">Max Wallets</Label>
                  <Input
                    id="limit"
                    type="number"
                    value={((node.data.config as any)?.limit as number) || 100}
                    onChange={(e) => handleUpdate("config", {
                      ...(node.data.config || {}),
                      limit: e.target.value ? Number(e.target.value) : 100
                    })}
                    placeholder="50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of wallets to return
                  </p>
                </div>
              </>
            )}
          </div>
        )

      case "FILTER":
        // Legacy single-condition filter
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="field">Field</Label>
              <Input
                id="field"
                value={((node.data.config as any)?.field as string) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  field: e.target.value
                })}
                placeholder="omega_ratio"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="operator">Operator</Label>
              <Select
                value={((node.data.config as any)?.operator as string) || "GREATER_THAN"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  operator: value
                })}
              >
                <SelectTrigger id="operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EQUALS">Equals</SelectItem>
                  <SelectItem value="NOT_EQUALS">Not Equals</SelectItem>
                  <SelectItem value="GREATER_THAN">Greater Than</SelectItem>
                  <SelectItem value="LESS_THAN">Less Than</SelectItem>
                  <SelectItem value="GREATER_THAN_OR_EQUAL">Greater Than or Equal</SelectItem>
                  <SelectItem value="LESS_THAN_OR_EQUAL">Less Than or Equal</SelectItem>
                  <SelectItem value="CONTAINS">Contains</SelectItem>
                  <SelectItem value="IN">In</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">Value</Label>
              <Input
                id="value"
                value={((node.data.config as any)?.value as string) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  value: e.target.value
                })}
                placeholder="1.5"
              />
            </div>
          </div>
        )

      case "ENHANCED_FILTER":
        // This case is handled by EnhancedFilterConfigPanel
        // Return null to avoid showing default config
        return null

      case "LOGIC":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="operator">Operator</Label>
              <Select
                value={((node.data.config as any)?.operator as string) || "AND"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  operator: value
                })}
              >
                <SelectTrigger id="operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AND">AND</SelectItem>
                  <SelectItem value="OR">OR</SelectItem>
                  <SelectItem value="NOT">NOT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Connect multiple filter outputs to this node to combine them.
            </p>
          </div>
        )

      case "AGGREGATION":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="function">Function</Label>
              <Select
                value={((node.data.config as any)?.function as string) || "COUNT"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  function: value
                })}
              >
                <SelectTrigger id="function">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COUNT">Count</SelectItem>
                  <SelectItem value="SUM">Sum</SelectItem>
                  <SelectItem value="AVG">Average</SelectItem>
                  <SelectItem value="MIN">Min</SelectItem>
                  <SelectItem value="MAX">Max</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {((node.data.config as any)?.function !== "COUNT") && (
              <div className="space-y-2">
                <Label htmlFor="field">Field</Label>
                <Input
                  id="field"
                  value={((node.data.config as any)?.field as string) || ""}
                  onChange={(e) => handleUpdate("config", {
                    ...(node.data.config || {}),
                    field: e.target.value
                  })}
                  placeholder="omega_ratio"
                />
              </div>
            )}
          </div>
        )

      case "SIGNAL":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signalType">Signal Type</Label>
              <Select
                value={((node.data.config as any)?.signalType as string) || undefined}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  signalType: value
                })}
              >
                <SelectTrigger id="signalType">
                  <SelectValue placeholder="Select signal type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENTRY">Entry</SelectItem>
                  <SelectItem value="EXIT">Exit</SelectItem>
                  <SelectItem value="ALERT">Alert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="direction">Direction</Label>
              <Select
                value={((node.data.config as any)?.direction as string) || undefined}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  direction: value
                })}
              >
                <SelectTrigger id="direction">
                  <SelectValue placeholder="Select direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">Yes</SelectItem>
                  <SelectItem value="NO">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="strength">Strength</Label>
              <Select
                value={((node.data.config as any)?.strength as string) || undefined}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  strength: value
                })}
              >
                <SelectTrigger id="strength">
                  <SelectValue placeholder="Select strength" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEAK">Weak</SelectItem>
                  <SelectItem value="MODERATE">Moderate</SelectItem>
                  <SelectItem value="STRONG">Strong</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="condition">Condition</Label>
              <Textarea
                id="condition"
                value={((node.data.config as any)?.condition as string) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  condition: e.target.value
                })}
                placeholder="omega_ratio > 1.5"
                rows={3}
              />
            </div>
          </div>
        )

      case "ACTION":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="action">Action</Label>
              <Select
                value={((node.data.config as any)?.action as string) || "ADD_TO_WATCHLIST"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  action: value
                })}
              >
                <SelectTrigger id="action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADD_TO_WATCHLIST">Add to Watchlist</SelectItem>
                  <SelectItem value="SEND_NOTIFICATION">Send Notification</SelectItem>
                  <SelectItem value="EXECUTE_TRADE">Execute Trade</SelectItem>
                  <SelectItem value="LOG_RESULT">Log Result</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Additional parameters can be configured based on the selected action.
            </p>
          </div>
        )

      case "add-to-watchlist":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Select
                value={((node.data.config as any)?.reason as string) || "smart-flow"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  reason: value
                })}
              >
                <SelectTrigger id="reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smart-flow">Smart Flow</SelectItem>
                  <SelectItem value="momentum">Momentum</SelectItem>
                  <SelectItem value="news">News</SelectItem>
                  <SelectItem value="arbitrage">Arbitrage</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category Filter (optional)</Label>
              <Input
                id="category"
                value={((node.data.config as any)?.category as string) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  category: e.target.value
                })}
                placeholder="e.g., politics, sports, crypto"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to monitor all categories
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="autoMonitor"
                checked={((node.data.config as any)?.autoMonitor as boolean) ?? true}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  autoMonitor: e.target.checked
                })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="autoMonitor" className="text-sm font-normal">
                Enable auto-monitoring for escalation
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Markets added to watchlist will be monitored for high conviction wallet activity and momentum signals.
            </p>
          </div>
        )

      case "start":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The Start node marks the entry point of your workflow. No configuration needed.
            </p>
          </div>
        )

      case "end":
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The End node marks the final output of your workflow. No configuration needed.
            </p>
          </div>
        )

      case "conditional":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="condition">Condition (JavaScript)</Label>
              <Textarea
                id="condition"
                value={(node.data.condition as string) || ""}
                onChange={(e) => handleUpdate("condition", e.target.value)}
                placeholder="input1 === 'US'"
                rows={4}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Write a JavaScript expression that evaluates to true or false. Use input1, input2, etc. to reference
                connected node outputs.
              </p>
            </div>
          </div>
        )

      case "httpRequest":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                value={(node.data.url as string) || ""}
                onChange={(e) => handleUpdate("url", e.target.value)}
                placeholder="https://api.example.com/endpoint"
              />
              <p className="text-xs text-muted-foreground">
                Use $input1, $input2, etc. to interpolate values in the URL
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="method">Method</Label>
              <Select value={(node.data.method as string) || "GET"} onValueChange={(value) => handleUpdate("method", value)}>
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="headers">Headers (JSON)</Label>
              <Textarea
                id="headers"
                value={(node.data.headers as string) || ""}
                onChange={(e) => handleUpdate("headers", e.target.value)}
                placeholder='{"Content-Type": "application/json"}'
                rows={3}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">Body (JSON)</Label>
              <Textarea
                id="body"
                value={(node.data.body as string) || ""}
                onChange={(e) => handleUpdate("body", e.target.value)}
                placeholder='{"key": "value"}'
                rows={4}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Use $input1, $input2, etc. to interpolate values</p>
            </div>
          </div>
        )

      case "textModel":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={(node.data.model as string) || "openai/gpt-5"} onValueChange={(value) => handleUpdate("model", value)}>
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai/gpt-5">OpenAI GPT-5</SelectItem>
                  <SelectItem value="openai/gpt-5-mini">OpenAI GPT-5 Mini</SelectItem>
                  <SelectItem value="anthropic/claude-sonnet-4.5">Claude Sonnet 4.5</SelectItem>
                  <SelectItem value="xai/grok-4">xAI Grok 4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="temperature">Temperature: {(node.data.temperature as number) || 0.7}</Label>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.1}
                value={[(node.data.temperature as number) || 0.7]}
                onValueChange={([value]) => handleUpdate("temperature", value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxTokens">Max Tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                value={(node.data.maxTokens as number) || 2000}
                onChange={(e) => handleUpdate("maxTokens", Number.parseInt(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="structuredOutput"
                  checked={(node.data.structuredOutput as boolean) || false}
                  onChange={(e) => handleUpdate("structuredOutput", e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="structuredOutput" className="cursor-pointer">
                  Structured Output
                </Label>
              </div>
            </div>

            {(node.data.structuredOutput as boolean) && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="schemaName">Schema Name</Label>
                  <Input
                    id="schemaName"
                    value={(node.data.schemaName as string) || ""}
                    onChange={(e) => handleUpdate("schemaName", e.target.value)}
                    placeholder="e.g., UserProfile"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schema">Schema (Zod)</Label>
                  <Textarea
                    id="schema"
                    value={(node.data.schema as string) || ""}
                    onChange={(e) => handleUpdate("schema", e.target.value)}
                    placeholder="z.object({ name: z.string(), age: z.number() })"
                    rows={4}
                    className="font-mono text-sm"
                  />
                </div>
              </>
            )}
          </div>
        )

      case "embeddingModel":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select
                value={(node.data.model as string) || "openai/text-embedding-3-small"}
                onValueChange={(value) => handleUpdate("model", value)}
              >
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai/text-embedding-3-small">OpenAI Embedding Small</SelectItem>
                  <SelectItem value="openai/text-embedding-3-large">OpenAI Embedding Large</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dimensions">Dimensions</Label>
              <Input
                id="dimensions"
                type="number"
                value={(node.data.dimensions as number) || 1536}
                onChange={(e) => handleUpdate("dimensions", Number.parseInt(e.target.value))}
              />
            </div>
          </div>
        )

      case "imageGeneration":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select
                value={(node.data.model as string) || "gemini-2.5-flash-image"}
                onValueChange={(value) => handleUpdate("model", value)}
              >
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</SelectItem>
                  <SelectItem value="openai/dall-e-3">DALL-E 3</SelectItem>
                  <SelectItem value="stability-ai/stable-diffusion">Stable Diffusion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="aspectRatio">Aspect Ratio</Label>
              <Select
                value={(node.data.aspectRatio as string) || "1:1"}
                onValueChange={(value) => handleUpdate("aspectRatio", value)}
              >
                <SelectTrigger id="aspectRatio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                  <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="outputFormat">Output Format</Label>
              <Select
                value={(node.data.outputFormat as string) || "png"}
                onValueChange={(value) => handleUpdate("outputFormat", value)}
              >
                <SelectTrigger id="outputFormat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpg">JPG</SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )

      case "audio":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={(node.data.model as string) || "openai/tts-1"} onValueChange={(value) => handleUpdate("model", value)}>
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai/tts-1">OpenAI TTS-1</SelectItem>
                  <SelectItem value="openai/tts-1-hd">OpenAI TTS-1 HD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="voice">Voice</Label>
              <Select value={(node.data.voice as string) || "alloy"} onValueChange={(value) => handleUpdate("voice", value)}>
                <SelectTrigger id="voice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alloy">Alloy</SelectItem>
                  <SelectItem value="echo">Echo</SelectItem>
                  <SelectItem value="fable">Fable</SelectItem>
                  <SelectItem value="onyx">Onyx</SelectItem>
                  <SelectItem value="nova">Nova</SelectItem>
                  <SelectItem value="shimmer">Shimmer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="speed">Speed: {(node.data.speed as number) || 1.0}</Label>
              <Slider
                id="speed"
                min={0.25}
                max={4.0}
                step={0.25}
                value={[(node.data.speed as number) || 1.0]}
                onValueChange={([value]) => handleUpdate("speed", value)}
              />
            </div>
          </div>
        )

      case "tool":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Tool Name</Label>
              <Input
                id="name"
                value={(node.data.name as string) || ""}
                onChange={(e) => handleUpdate("name", e.target.value)}
                placeholder="e.g., getWeather"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={(node.data.description as string) || ""}
                onChange={(e) => handleUpdate("description", e.target.value)}
                placeholder="Describe what this tool does..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Implementation (JavaScript)</Label>
              <Textarea
                id="code"
                value={(node.data.code as string) || ""}
                onChange={(e) => handleUpdate("code", e.target.value)}
                placeholder="// Tool implementation&#10;async function execute(args) {&#10;  // Your code here&#10;  return result;&#10;}"
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Write the JavaScript function that implements this tool</p>
            </div>
          </div>
        )

      case "structuredOutput":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="schemaName">Schema Name</Label>
              <Input
                id="schemaName"
                value={(node.data.schemaName as string) || ""}
                onChange={(e) => handleUpdate("schemaName", e.target.value)}
                placeholder="e.g., UserProfile"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mode">Mode</Label>
              <Select value={(node.data.mode as string) || "object"} onValueChange={(value) => handleUpdate("mode", value)}>
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="object">Object</SelectItem>
                  <SelectItem value="array">Array</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )

      case "prompt":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="content">Prompt Content</Label>
              <Textarea
                id="content"
                value={(node.data.content as string) || ""}
                onChange={(e) => handleUpdate("content", e.target.value)}
                placeholder="Enter your prompt..."
                rows={6}
              />
              <p className="text-xs text-muted-foreground">
                Use $input1, $input2, etc. to reference outputs from connected nodes
              </p>
            </div>
          </div>
        )

      case "javascript":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">JavaScript Code</Label>
              <Textarea
                id="code"
                value={(node.data.code as string) || ""}
                onChange={(e) => handleUpdate("code", e.target.value)}
                placeholder="// Access inputs as input1, input2, etc.&#10;return input1.toUpperCase()"
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Access connected node outputs as input1, input2, etc. Return a value to pass to the next node.
              </p>
            </div>
          </div>
        )

      case "polymarket-stream":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="categories">Categories (comma-separated)</Label>
              <Input
                id="categories"
                value={((node.data.config as any)?.categories?.join(", ") as string) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  categories: e.target.value.split(",").map((c: string) => c.trim()).filter(Boolean)
                })}
                placeholder="Politics, Sports, Crypto"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to fetch all categories
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="minVolume">Minimum Volume (USD)</Label>
              <Input
                id="minVolume"
                type="number"
                value={((node.data.config as any)?.minVolume as number) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  minVolume: e.target.value ? Number(e.target.value) : undefined
                })}
                placeholder="10000"
              />
            </div>
          </div>
        )

      case "filter":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Filter Conditions (JSON)</Label>
              <Textarea
                value={JSON.stringify((node.data.config as any)?.conditions || [], null, 2)}
                onChange={(e) => {
                  try {
                    const conditions = JSON.parse(e.target.value)
                    handleUpdate("config", { ...(node.data.config || {}), conditions })
                  } catch (err) {
                    // Invalid JSON, don't update
                  }
                }}
                placeholder='[{"field": "volume", "operator": ">", "value": 10000}]'
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Example: {`[{"field": "volume", "operator": ">", "value": 10000}]`}
              </p>
            </div>
          </div>
        )

      case "llm-analysis":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="userPrompt">Analysis Prompt</Label>
              <Textarea
                id="userPrompt"
                value={((node.data.config as any)?.userPrompt as string) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  userPrompt: e.target.value
                })}
                placeholder="Analyze this market and predict the outcome..."
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outputFormat">Output Format</Label>
              <Select
                value={((node.data.config as any)?.outputFormat as string) || "text"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  outputFormat: value
                })}
              >
                <SelectTrigger id="outputFormat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )

      case "transform":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Transform Operations (JSON)</Label>
              <Textarea
                value={JSON.stringify((node.data.config as any)?.operations || [], null, 2)}
                onChange={(e) => {
                  try {
                    const operations = JSON.parse(e.target.value)
                    handleUpdate("config", { ...(node.data.config || {}), operations })
                  } catch (err) {
                    // Invalid JSON, don't update
                  }
                }}
                placeholder='[{"type": "calculate", "config": {"name": "roi", "formula": "(price - cost) / cost"}}]'
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Example: {`[{"type": "calculate", "config": {"name": "roi", "formula": "(price - cost) / cost"}}]`}
              </p>
            </div>
          </div>
        )

      case "condition":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>If/Then/Else Conditions (JSON)</Label>
              <Textarea
                value={JSON.stringify((node.data.config as any)?.conditions || [], null, 2)}
                onChange={(e) => {
                  try {
                    const conditions = JSON.parse(e.target.value)
                    handleUpdate("config", { ...(node.data.config || {}), conditions })
                  } catch (err) {
                    // Invalid JSON, don't update
                  }
                }}
                placeholder='[{"if": "volume > 10000", "then": "buy", "else": "skip"}]'
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Example: {`[{"if": "volume > 10000", "then": "buy", "else": "skip"}]`}
              </p>
            </div>
          </div>
        )

      case "polymarket-buy":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="outcome">Outcome</Label>
              <Select
                value={((node.data.config as any)?.outcome as string) || "YES"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  outcome: value
                })}
              >
                <SelectTrigger id="outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">YES</SelectItem>
                  <SelectItem value="NO">NO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                type="number"
                value={((node.data.config as any)?.amount as number) || ""}
                onChange={(e) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  amount: Number(e.target.value)
                })}
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderType">Order Type</Label>
              <Select
                value={((node.data.config as any)?.orderType as string) || "market"}
                onValueChange={(value) => handleUpdate("config", {
                  ...(node.data.config || {}),
                  orderType: value
                })}
              >
                <SelectTrigger id="orderType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market Order</SelectItem>
                  <SelectItem value="limit">Limit Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )

      default:
        return <p className="text-sm text-muted-foreground">No configuration available</p>
    }
  }

  const handleDelete = () => {
    if (onDelete && node) {
      if (confirm(`Delete "${node.type}" node?`)) {
        onDelete(node.id)
        onClose()
      }
    }
  }

  return (
    <aside className="absolute right-0 top-0 z-10 h-full w-full border-l border-border bg-card md:relative md:w-80 flex flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Node Configuration</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="overflow-y-auto p-4 flex-1">
        {renderConfig()}
      </div>

      {/* Data Preview Section */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex w-full items-center justify-between p-4 text-sm font-medium hover:bg-muted/50 transition"
        >
          <div className="flex items-center gap-2">
            <TableIcon className="h-4 w-4 text-[#00E0AA]" />
            <span>Output Preview</span>
            <span className="text-xs text-muted-foreground">({sampleData.length} rows)</span>
          </div>
          {showPreview ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showPreview && (
          <div className="border-t border-border bg-muted/20">
            <Tabs defaultValue="table" className="w-full">
              <TabsList className="w-full rounded-none border-b bg-transparent h-auto p-0">
                <TabsTrigger
                  value="table"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent"
                >
                  <TableIcon className="h-3 w-3 mr-1" />
                  Table
                </TabsTrigger>
                <TabsTrigger
                  value="json"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent"
                >
                  <Code className="h-3 w-3 mr-1" />
                  JSON
                </TabsTrigger>
              </TabsList>

              <TabsContent value="table" className="m-0 max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {sampleKeys.map((key) => (
                        <TableHead key={key} className="text-xs font-semibold">
                          {key}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleData.map((row, i) => (
                      <TableRow key={i}>
                        {sampleKeys.map((key) => (
                          <TableCell key={key} className="text-xs font-mono">
                            {typeof (row as any)[key] === 'object'
                              ? JSON.stringify((row as any)[key])
                              : String((row as any)[key])
                            }
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="json" className="m-0 max-h-64 overflow-auto p-4">
                <pre className="text-xs font-mono text-foreground">
                  {JSON.stringify(sampleData, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {onDelete && node.type !== 'start' && node.type !== 'end' && (
        <div className="border-t border-border p-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            className="w-full gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Delete Node
          </Button>
        </div>
      )}
    </aside>
  )
}
