"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  X,
  Save,
  Trash2,
  Code2,
  Globe,
  GitBranch,
  PlayCircle,
  StopCircle,
  Settings2,
  Info,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { cn } from "@/lib/utils"

type NodeType = "start" | "end" | "httpRequest" | "conditional" | "javascript" | "webhook" | "delay"

type NodeConfig = {
  id: string
  type: NodeType
  label: string
  description: string
  config: Record<string, any>
}

type NodeConfigPanelProps = {
  node: NodeConfig | null
  onClose: () => void
  onSave: (node: NodeConfig) => void
  onDelete?: (nodeId: string) => void
}

const nodeTypeInfo: Record<
  NodeType,
  {
    icon: React.ElementType
    color: string
    bg: string
    border: string
    description: string
  }
> = {
  start: {
    icon: PlayCircle,
    color: "#00E0AA",
    bg: "rgba(0,224,170,0.12)",
    border: "rgba(0,224,170,0.35)",
    description: "Entry point for the workflow",
  },
  end: {
    icon: StopCircle,
    color: "#a855f7",
    bg: "rgba(168,85,247,0.12)",
    border: "rgba(168,85,247,0.35)",
    description: "Exit point for the workflow",
  },
  httpRequest: {
    icon: Globe,
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
    border: "rgba(59,130,246,0.35)",
    description: "Make HTTP requests to external APIs",
  },
  conditional: {
    icon: GitBranch,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
    border: "rgba(245,158,11,0.35)",
    description: "Branch workflow based on conditions",
  },
  javascript: {
    icon: Code2,
    color: "#818cf8",
    bg: "rgba(129,140,248,0.12)",
    border: "rgba(129,140,248,0.35)",
    description: "Execute custom JavaScript code",
  },
  webhook: {
    icon: Globe,
    color: "#ec4899",
    bg: "rgba(236,72,153,0.12)",
    border: "rgba(236,72,153,0.35)",
    description: "Trigger workflow via webhook",
  },
  delay: {
    icon: Settings2,
    color: "#6366f1",
    bg: "rgba(99,102,241,0.12)",
    border: "rgba(99,102,241,0.35)",
    description: "Pause workflow for a specified duration",
  },
}

export function NodeConfigPanel({ node, onClose, onSave, onDelete }: NodeConfigPanelProps) {
  const [editedNode, setEditedNode] = useState<NodeConfig | null>(node)
  const [showAdvanced, setShowAdvanced] = useState(false)

  if (!node || !editedNode) {
    return null
  }

  const nodeInfo = nodeTypeInfo[node.type]
  const Icon = nodeInfo.icon

  const handleSave = () => {
    if (editedNode) {
      onSave(editedNode)
      onClose()
    }
  }

  const handleDelete = () => {
    if (editedNode && onDelete) {
      onDelete(editedNode.id)
      onClose()
    }
  }

  const updateConfig = (key: string, value: any) => {
    setEditedNode(prev =>
      prev
        ? {
            ...prev,
            config: { ...prev.config, [key]: value },
          }
        : null
    )
  }

  const updateField = (field: keyof NodeConfig, value: any) => {
    setEditedNode(prev => (prev ? { ...prev, [field]: value } : null))
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header with Gradient */}
      <div className="relative shrink-0 overflow-hidden border-b border-border/40 bg-gradient-to-br from-background via-background to-background/95 px-6 py-5 shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background: `radial-gradient(circle at 15% 20%, ${nodeInfo.bg}, transparent 50%), radial-gradient(circle at 85% 25%, ${nodeInfo.bg}, transparent 45%)`,
          }}
          aria-hidden="true"
        />

        <div className="relative">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg"
                style={{
                  backgroundColor: nodeInfo.bg,
                  color: nodeInfo.color,
                  boxShadow: `0 4px 14px ${nodeInfo.bg}`,
                }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">Node Configuration</h2>
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide"
                    style={{
                      borderColor: nodeInfo.border,
                      color: nodeInfo.color,
                      backgroundColor: nodeInfo.bg,
                    }}
                  >
                    {node.type}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{nodeInfo.description}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-xl transition hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-6">
          {/* Basic Settings */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-[#00E0AA]" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Basic Settings
              </h3>
            </div>

            <div className="space-y-4">
              {/* Node Label */}
              <div className="space-y-2">
                <Label htmlFor="node-label" className="text-sm font-medium text-foreground">
                  Node Label
                </Label>
                <Input
                  id="node-label"
                  value={editedNode.label}
                  onChange={e => updateField("label", e.target.value)}
                  placeholder="Enter node label"
                  className="rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
                />
              </div>

              {/* Node Description */}
              <div className="space-y-2">
                <Label htmlFor="node-description" className="text-sm font-medium text-foreground">
                  Description
                </Label>
                <Textarea
                  id="node-description"
                  value={editedNode.description}
                  onChange={e => updateField("description", e.target.value)}
                  placeholder="Enter node description"
                  rows={3}
                  className="rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
                />
              </div>
            </div>
          </section>

          <Separator className="bg-border/60" />

          {/* Type-Specific Configuration */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" style={{ color: nodeInfo.color }} />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Configuration
              </h3>
            </div>

            {node.type === "httpRequest" && <HttpRequestConfig node={editedNode} updateConfig={updateConfig} />}
            {node.type === "conditional" && <ConditionalConfig node={editedNode} updateConfig={updateConfig} />}
            {node.type === "javascript" && <JavaScriptConfig node={editedNode} updateConfig={updateConfig} />}
            {node.type === "webhook" && <WebhookConfig node={editedNode} updateConfig={updateConfig} />}
            {node.type === "delay" && <DelayConfig node={editedNode} updateConfig={updateConfig} />}
            {(node.type === "start" || node.type === "end") && (
              <div className="rounded-2xl border border-border/40 bg-muted/20 p-6 text-center">
                <Info className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  This node type has no additional configuration options.
                </p>
              </div>
            )}
          </section>

          {/* Advanced Settings (Collapsible) */}
          <section className="space-y-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-left transition hover:bg-muted/30"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Advanced Settings</span>
              </div>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-2xl border border-border/40 bg-muted/10 p-4">
                <div className="space-y-2">
                  <Label htmlFor="node-id" className="text-sm font-medium text-muted-foreground">
                    Node ID
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="node-id"
                      value={editedNode.id}
                      disabled
                      className="rounded-xl border-border/60 bg-muted/50 font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0 rounded-xl border-border/60 transition hover:border-[#00E0AA]/60 hover:bg-[#00E0AA]/5"
                      onClick={() => navigator.clipboard.writeText(editedNode.id)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="retry-attempts" className="text-sm font-medium text-foreground">
                    Retry Attempts
                  </Label>
                  <Input
                    id="retry-attempts"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue={3}
                    placeholder="3"
                    className="rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeout" className="text-sm font-medium text-foreground">
                    Timeout (seconds)
                  </Label>
                  <Input
                    id="timeout"
                    type="number"
                    min="1"
                    max="300"
                    defaultValue={30}
                    placeholder="30"
                    className="rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="shrink-0 border-t border-border/40 bg-background/95 p-6 shadow-sm">
        <div className="flex gap-3">
          <Button
            onClick={handleSave}
            className="flex-1 gap-2 rounded-full bg-[#00E0AA] px-6 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 gap-2 rounded-xl border-border/60 transition hover:border-border hover:bg-muted"
          >
            Cancel
          </Button>
          {onDelete && node.type !== "start" && node.type !== "end" && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleDelete}
              className="shrink-0 rounded-xl border-red-500/60 text-red-500 transition hover:border-red-500 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// HTTP Request Configuration
function HttpRequestConfig({
  node,
  updateConfig,
}: {
  node: NodeConfig
  updateConfig: (key: string, value: any) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="http-method" className="text-sm font-medium text-foreground">
          HTTP Method
        </Label>
        <Select
          value={node.config.method || "GET"}
          onValueChange={value => updateConfig("method", value)}
        >
          <SelectTrigger
            id="http-method"
            className="rounded-xl border-border/60 transition focus:border-[#00E0AA]/50 focus:ring-[#00E0AA]/20"
          >
            <SelectValue placeholder="Select method" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
            <SelectItem value="PATCH">PATCH</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="http-url" className="text-sm font-medium text-foreground">
          URL
        </Label>
        <Input
          id="http-url"
          value={node.config.url || ""}
          onChange={e => updateConfig("url", e.target.value)}
          placeholder="https://api.example.com/endpoint"
          className="rounded-xl border-border/60 font-mono text-sm transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="http-headers" className="text-sm font-medium text-foreground">
          Headers (JSON)
        </Label>
        <Textarea
          id="http-headers"
          value={node.config.headers || ""}
          onChange={e => updateConfig("headers", e.target.value)}
          placeholder='{"Content-Type": "application/json"}'
          rows={4}
          className="rounded-xl border-border/60 font-mono text-sm transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
        />
      </div>

      {(node.config.method === "POST" || node.config.method === "PUT" || node.config.method === "PATCH") && (
        <div className="space-y-2">
          <Label htmlFor="http-body" className="text-sm font-medium text-foreground">
            Request Body (JSON)
          </Label>
          <Textarea
            id="http-body"
            value={node.config.body || ""}
            onChange={e => updateConfig("body", e.target.value)}
            placeholder='{"key": "value"}'
            rows={6}
            className="rounded-xl border-border/60 font-mono text-sm transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
          />
        </div>
      )}
    </div>
  )
}

// Conditional Configuration
function ConditionalConfig({
  node,
  updateConfig,
}: {
  node: NodeConfig
  updateConfig: (key: string, value: any) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="condition" className="text-sm font-medium text-foreground">
          Condition Expression
        </Label>
        <Input
          id="condition"
          value={node.config.condition || ""}
          onChange={e => updateConfig("condition", e.target.value)}
          placeholder="e.g., input1.value > 100"
          className="rounded-xl border-border/60 font-mono text-sm transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
        />
        <p className="text-xs text-muted-foreground">
          Use JavaScript expressions. Access previous node outputs via <code className="rounded bg-muted px-1 py-0.5">input1</code>, <code className="rounded bg-muted px-1 py-0.5">input2</code>, etc.
        </p>
      </div>

      <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4">
        <div className="flex gap-3">
          <Info className="h-5 w-5 shrink-0 text-blue-500" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Condition Examples:</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li><code className="rounded bg-muted px-1 py-0.5">input1.price &gt; 100</code></li>
              <li><code className="rounded bg-muted px-1 py-0.5">input1.status === &apos;active&apos;</code></li>
              <li><code className="rounded bg-muted px-1 py-0.5">input1.sii &gt; 60 && input1.volume &gt; 1000</code></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// JavaScript Configuration
function JavaScriptConfig({
  node,
  updateConfig,
}: {
  node: NodeConfig
  updateConfig: (key: string, value: any) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="js-code" className="text-sm font-medium text-foreground">
          JavaScript Code
        </Label>
        <Textarea
          id="js-code"
          value={node.config.code || ""}
          onChange={e => updateConfig("code", e.target.value)}
          placeholder="// Access input data via input1, input2, etc.&#10;// Return data for next node&#10;return { result: input1.value * 2 }"
          rows={12}
          className="rounded-xl border-border/60 font-mono text-sm transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
        />
        <p className="text-xs text-muted-foreground">
          Write JavaScript code to transform data. Use <code className="rounded bg-muted px-1 py-0.5">return</code> to pass data to the next node.
        </p>
      </div>

      <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4">
        <div className="flex gap-3">
          <Code2 className="h-5 w-5 shrink-0 text-purple-500" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Available Variables:</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li><code className="rounded bg-muted px-1 py-0.5">input1, input2, ...</code> - Previous node outputs</li>
              <li><code className="rounded bg-muted px-1 py-0.5">$env</code> - Environment variables</li>
              <li><code className="rounded bg-muted px-1 py-0.5">$now</code> - Current timestamp</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// Webhook Configuration
function WebhookConfig({
  node,
  updateConfig,
}: {
  node: NodeConfig
  updateConfig: (key: string, value: any) => void
}) {
  const webhookUrl = `https://api.cascadian.app/webhook/${node.id}`

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="webhook-url" className="text-sm font-medium text-foreground">
          Webhook URL
        </Label>
        <div className="flex gap-2">
          <Input
            id="webhook-url"
            value={webhookUrl}
            disabled
            className="rounded-xl border-border/60 bg-muted/50 font-mono text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-xl border-border/60 transition hover:border-[#00E0AA]/60 hover:bg-[#00E0AA]/5"
            onClick={() => navigator.clipboard.writeText(webhookUrl)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Send POST requests to this URL to trigger the workflow
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="webhook-secret" className="text-sm font-medium text-foreground">
          Webhook Secret (Optional)
        </Label>
        <Input
          id="webhook-secret"
          value={node.config.secret || ""}
          onChange={e => updateConfig("secret", e.target.value)}
          placeholder="Enter a secret key for validation"
          type="password"
          className="rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
        />
      </div>
    </div>
  )
}

// Delay Configuration
function DelayConfig({
  node,
  updateConfig,
}: {
  node: NodeConfig
  updateConfig: (key: string, value: any) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="delay-duration" className="text-sm font-medium text-foreground">
          Delay Duration
        </Label>
        <div className="flex gap-2">
          <Input
            id="delay-duration"
            type="number"
            min="1"
            value={node.config.duration || 60}
            onChange={e => updateConfig("duration", parseInt(e.target.value))}
            className="flex-1 rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
          />
          <Select
            value={node.config.unit || "seconds"}
            onValueChange={value => updateConfig("unit", value)}
          >
            <SelectTrigger className="w-32 rounded-xl border-border/60 transition focus:border-[#00E0AA]/50 focus:ring-[#00E0AA]/20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="seconds">Seconds</SelectItem>
              <SelectItem value="minutes">Minutes</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
