"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Plus,
  Search,
  Sparkles,
  Layers,
  FileText,
  Edit,
  Copy,
  Trash2,
  Clock,
  Play,
  Square,
  Activity,
  Loader2,
  Database,
  Filter,
  GitMerge,
  BarChart3,
  Radio,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react"
import { useState, useEffect } from "react"
import { useToast } from "@/components/ui/use-toast"
import type { StrategyDefinition } from "@/lib/strategy-builder/types"
import { formatDistanceToNow } from "date-fns"
import { LineChart, Line, ResponsiveContainer } from "recharts"

type Strategy = StrategyDefinition & {
  nodeCount?: number
  performanceData?: Array<{ value: number }>
  performanceChange?: number
}

const nodeTypeIcons: Record<string, any> = {
  DATA_SOURCE: Database,
  FILTER: Filter,
  LOGIC: GitMerge,
  AGGREGATION: BarChart3,
  SIGNAL: Radio,
  ACTION: Zap,
}

type StrategyLibraryProps = {
  onCreateNew: () => void
  onEditStrategy: (strategyId: string) => void
}

export function StrategyLibrary({ onCreateNew, onEditStrategy }: StrategyLibraryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("all")
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    loadStrategies()
  }, [])

  async function loadStrategies() {
    try {
      setLoading(true)

      const response = await fetch("/api/strategies")
      if (!response.ok) {
        throw new Error("Failed to load strategies")
      }

      const data = await response.json()

      // Fetch performance data for each strategy in parallel
      const strategiesWithPerformance = await Promise.all(
        (data.strategies || []).map(async (s: any) => {
          let performanceData: Array<{ value: number }> = []
          let performanceChange = 0

          try {
            const perfResponse = await fetch(`/api/strategies/${s.strategy_id}/performance`)
            if (perfResponse.ok) {
              const perfData = await perfResponse.json()
              if (perfData.performance && perfData.performance.length > 0) {
                // Use last 10 data points for sparkline
                const recentData = perfData.performance.slice(-10)
                performanceData = recentData.map((p: any) => ({ value: p.portfolio_value_usd || 0 }))

                // Calculate performance change
                const firstValue = recentData[0]?.portfolio_value_usd || 0
                const lastValue = recentData[recentData.length - 1]?.portfolio_value_usd || 0
                performanceChange = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0
              } else {
                // No performance data - show flat line at 0
                performanceData = Array(10).fill({ value: 0 })
                performanceChange = 0
              }
            } else {
              // API error - show flat line at 0
              performanceData = Array(10).fill({ value: 0 })
              performanceChange = 0
            }
          } catch (error) {
            // Error fetching performance - show flat line at 0
            performanceData = Array(10).fill({ value: 0 })
            performanceChange = 0
          }

          return {
            strategyId: s.strategy_id,
            strategyName: s.strategy_name,
            strategyDescription: s.strategy_description || "",
            strategyType: s.strategy_type,
            isPredefined: s.is_predefined,
            nodeGraph: s.node_graph,
            executionMode: s.execution_mode,
            scheduleCron: s.schedule_cron,
            isActive: s.is_active,
            createdBy: s.created_by,
            createdAt: new Date(s.created_at),
            updatedAt: new Date(s.updated_at),
            nodeCount: s.node_graph?.nodes?.length || 0,
            performanceData,
            performanceChange,
          }
        })
      )

      setStrategies(strategiesWithPerformance)
    } catch (error: any) {
      console.error("Error loading strategies:", error)
      toast({
        title: "Error loading strategies",
        description: error.message,
        variant: "destructive",
      })
      setStrategies([])
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (strategyId: string) => {
    if (!confirm("Delete this strategy? This action cannot be undone.")) {
      return
    }

    try {
      const response = await fetch(`/api/strategies/${strategyId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete strategy")
      }

      toast({
        title: "Strategy deleted",
        description: "The strategy has been removed",
      })

      // Reload strategies
      loadStrategies()
    } catch (error: any) {
      console.error("Error deleting strategy:", error)
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  const defaultStrategies = strategies.filter((s) => s.isPredefined)
  const customStrategies = strategies.filter((s) => !s.isPredefined)
  const allStrategies = strategies

  const filteredStrategies = allStrategies.filter((strategy) => {
    const matchesSearch =
      strategy.strategyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      strategy.strategyDescription?.toLowerCase().includes(searchQuery.toLowerCase())

    if (activeTab === "all") return matchesSearch
    if (activeTab === "default") return matchesSearch && strategy.isPredefined
    if (activeTab === "custom") return matchesSearch && !strategy.isPredefined

    return matchesSearch
  })

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA] mb-4" />
          <p className="text-sm text-muted-foreground">Loading strategies...</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Header with Modern Design */}
          <div className="relative shrink-0 overflow-hidden border-b border-border/40 bg-gradient-to-br from-background via-background to-background/95 px-6 py-6 shadow-sm">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                background:
                  "radial-gradient(circle at 20% 25%, rgba(0,224,170,0.15), transparent 50%), radial-gradient(circle at 85% 30%, rgba(0,224,170,0.08), transparent 45%)",
              }}
              aria-hidden="true"
            />

            <div className="relative">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-lg shadow-[#00E0AA]/20">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Strategy Library</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Build and manage wallet screening strategies
                    </p>
                  </div>
                </div>
                <Button
                  onClick={onCreateNew}
                  className="gap-2 rounded-full bg-[#00E0AA] px-6 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90"
                >
                  <Plus className="h-4 w-4" />
                  Create New Strategy
                </Button>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search strategies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 rounded-xl border-border/60 transition focus-visible:border-[#00E0AA]/50 focus-visible:ring-[#00E0AA]/20"
                />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <div className="border-b border-border/40 px-6">
              <TabsList className="bg-transparent h-auto p-0 gap-1">
                <TabsTrigger
                  value="all"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#00E0AA] data-[state=active]:text-[#00E0AA] rounded-none px-4 py-3 transition"
                >
                  All Strategies ({allStrategies.length})
                </TabsTrigger>
                <TabsTrigger
                  value="default"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#00E0AA] data-[state=active]:text-[#00E0AA] rounded-none px-4 py-3 transition"
                >
                  Default Templates ({defaultStrategies.length})
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#00E0AA] data-[state=active]:text-[#00E0AA] rounded-none px-4 py-3 transition"
                >
                  My Strategies ({customStrategies.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-auto">
              <TabsContent value="all" className="mt-0 p-6">
                <StrategyGrid strategies={filteredStrategies} onEdit={onEditStrategy} onDelete={handleDelete} />
              </TabsContent>
              <TabsContent value="default" className="mt-0 p-6">
                <StrategyGrid strategies={filteredStrategies} onEdit={onEditStrategy} onDelete={handleDelete} />
              </TabsContent>
              <TabsContent value="custom" className="mt-0 p-6">
                <StrategyGrid strategies={filteredStrategies} onEdit={onEditStrategy} onDelete={handleDelete} />
              </TabsContent>
            </div>
          </Tabs>
        </>
      )}
    </div>
  )
}

function StrategyGrid({
  strategies,
  onEdit,
  onDelete,
}: {
  strategies: Strategy[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (strategies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-muted/30 p-6">
          <FileText className="h-16 w-16 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No strategies found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Try adjusting your search or create a new strategy to get started
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {strategies.map((strategy) => (
        <StrategyCard key={strategy.strategyId} strategy={strategy} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}

function StrategyCard({
  strategy,
  onEdit,
  onDelete,
}: {
  strategy: Strategy
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  // Count node types
  const nodeTypeCounts = strategy.nodeGraph.nodes.reduce((acc: Record<string, number>, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1
    return acc
  }, {})

  return (
    <Card className="group overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-xl flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="rounded-xl bg-[#00E0AA]/10 p-2 shadow-sm">
              <Layers className="h-4 w-4 text-[#00E0AA]" />
            </div>
            {strategy.isPredefined && (
              <Badge variant="secondary" className="gap-1 rounded-full text-xs">
                <Sparkles className="h-3 w-3" />
                Template
              </Badge>
            )}
            {strategy.isActive && (
              <Badge className="gap-1 rounded-full bg-green-600 text-xs hover:bg-green-600">
                <Activity className="h-3 w-3" />
                Active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(strategy.updatedAt, { addSuffix: true })}
          </div>
        </div>
        <CardTitle className="text-lg font-semibold tracking-tight">{strategy.strategyName}</CardTitle>
        <CardDescription className="line-clamp-2 text-sm">
          {strategy.strategyDescription || "No description"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {/* Performance Chart */}
        <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">Performance</span>
            <div className="flex items-center gap-1">
              {strategy.performanceChange === 0 ? (
                <Minus className="h-3 w-3 text-muted-foreground" />
              ) : strategy.performanceChange && strategy.performanceChange > 0 ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              <span
                className={`text-xs font-semibold ${
                  strategy.performanceChange === 0
                    ? "text-muted-foreground"
                    : strategy.performanceChange && strategy.performanceChange > 0
                    ? "text-green-500"
                    : "text-red-500"
                }`}
              >
                {strategy.performanceChange === 0 ? "0.00" : strategy.performanceChange?.toFixed(2)}%
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={strategy.performanceData || []}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={
                  strategy.performanceChange === 0
                    ? "hsl(var(--muted-foreground))"
                    : strategy.performanceChange && strategy.performanceChange > 0
                    ? "#22c55e"
                    : "#ef4444"
                }
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Combined Total Nodes and Node Types - Same Row */}
        <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">Total Nodes:</span>
            <span className="text-sm font-semibold">{strategy.nodeCount || 0}</span>
          </div>

          {/* Node type breakdown - inline with node count */}
          {Object.keys(nodeTypeCounts).length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/30">
              <span className="text-xs text-muted-foreground mr-1 mt-1">Types:</span>
              {Object.entries(nodeTypeCounts).map(([type, count]) => {
                const Icon = nodeTypeIcons[type] || Layers
                return (
                  <div
                    key={type}
                    className="flex items-center gap-1 bg-background/80 rounded-md px-1.5 py-0.5 text-xs"
                  >
                    <Icon className="h-3 w-3 text-[#00E0AA]" />
                    <span className="font-medium">{count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="border-t border-border/50 pt-3 pb-4">
        {/* Edit and Delete buttons on same row */}
        <div className="flex gap-2 w-full">
          <Button
            variant="default"
            className="flex-1 gap-2 rounded-xl bg-[#00E0AA] text-slate-950 shadow-sm hover:bg-[#00E0AA]/90"
            onClick={() => onEdit(strategy.strategyId)}
          >
            <Edit className="h-4 w-4" />
            Edit Strategy
          </Button>

          {/* Delete button - only for custom strategies */}
          {!strategy.isPredefined && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-xl border-border/60 transition hover:border-red-500/60 hover:bg-red-500/5 hover:text-red-500"
              onClick={() => onDelete(strategy.strategyId)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
