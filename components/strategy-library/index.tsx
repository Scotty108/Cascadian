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
  TrendingUp,
  Repeat,
  Zap,
  Layers,
  FileText,
  Edit,
  Copy,
  Trash2,
  Star,
  Clock,
  BarChart,
  Play,
  Square,
  Activity,
  LineChart,
  Loader2
} from "lucide-react"
import { useState, useEffect } from "react"
import Link from "next/link"
import { workflowSessionService } from "@/lib/services/workflow-session-service"
import type { WorkflowSession } from "@/types/database"
import { formatDistanceToNow } from "date-fns"
import { useToast } from "@/components/ui/use-toast"

type Strategy = {
  id: string
  name: string
  description: string
  type: "default" | "custom"
  category: "dca" | "arbitrage" | "signal" | "ai" | "scalping" | "momentum"
  nodes: number
  lastModified?: string
  performance?: {
    roi: number
    trades: number
    winRate: number
  }
  isDefault?: boolean
  status?: 'draft' | 'active' | 'paused' | 'archived'
  totalExecutions?: number
  successfulExecutions?: number
}

const categoryIcons = {
  dca: Repeat,
  arbitrage: Layers,
  signal: Zap,
  ai: Sparkles,
  scalping: TrendingUp,
  momentum: BarChart
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
      let mappedStrategies: Strategy[] = []

      // Try to load from database first
      const { data: workflows, error } = await workflowSessionService.listWorkflows({
        orderBy: 'updated_at',
        orderDirection: 'desc',
        limit: 100,
      })

      if (!error && workflows && workflows.length > 0) {
        // Map database workflows to strategies
        mappedStrategies = workflows.map((workflow) => {
          return {
            id: workflow.id,
            name: workflow.name,
            description: workflow.description || '',
            type: workflow.isTemplate ? 'default' as const : 'custom' as const,
            category: (workflow.tags?.[0] as any) || 'ai',
            nodes: workflow.nodes.length,
            lastModified: formatDistanceToNow(new Date(workflow.updatedAt), { addSuffix: true }),
            isDefault: workflow.isTemplate,
            status: workflow.status,
            totalExecutions: 0,
            successfulExecutions: 0,
            performance: undefined,
          }
        })
      }

      // FALLBACK: Load from localStorage if database is empty or errored
      if (mappedStrategies.length === 0) {
        console.log('Loading strategies from localStorage (fallback)')
        const STORAGE_KEY = "ai-agent-builder-workflow"
        const savedWorkflow = localStorage.getItem(STORAGE_KEY)

        if (savedWorkflow) {
          try {
            const workflow = JSON.parse(savedWorkflow)
            if (workflow.nodes && workflow.nodes.length > 0) {
              mappedStrategies.push({
                id: workflow.id || 'local-strategy',
                name: workflow.name || 'Untitled Strategy',
                description: 'Saved locally (not in database)',
                type: 'custom' as const,
                category: 'ai',
                nodes: workflow.nodes.length,
                lastModified: 'recently',
                isDefault: false,
                status: 'draft',
                totalExecutions: 0,
                successfulExecutions: 0,
                performance: undefined,
              })
            }
          } catch (parseError) {
            console.error('Error parsing localStorage workflow:', parseError)
          }
        }
      }

      setStrategies(mappedStrategies)
    } catch (error: any) {
      console.error('Error loading strategies:', error)
      // Don't show toast for auth errors - user just isn't logged in
      if (!error.message?.includes('JWT') && !error.message?.includes('auth')) {
        toast({
          title: "Error loading strategies",
          description: error.message,
          variant: "destructive",
        })
      }
      setStrategies([])
    } finally {
      setLoading(false)
    }
  }

  const defaultStrategies = strategies.filter(s => s.type === 'default')
  const customStrategies = strategies.filter(s => s.type === 'custom')
  const allStrategies = strategies

  const filteredStrategies = allStrategies.filter(strategy => {
    const matchesSearch = strategy.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         strategy.description.toLowerCase().includes(searchQuery.toLowerCase())

    if (activeTab === "all") return matchesSearch
    if (activeTab === "default") return matchesSearch && strategy.type === "default"
    if (activeTab === "custom") return matchesSearch && strategy.type === "custom"

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
                  Create, edit, and manage your trading strategies
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
            <StrategyGrid strategies={filteredStrategies} onEdit={onEditStrategy} />
          </TabsContent>
          <TabsContent value="default" className="mt-0 p-6">
            <StrategyGrid strategies={filteredStrategies} onEdit={onEditStrategy} />
          </TabsContent>
          <TabsContent value="custom" className="mt-0 p-6">
            <StrategyGrid strategies={filteredStrategies} onEdit={onEditStrategy} />
          </TabsContent>
        </div>
      </Tabs>
        </>
      )}
    </div>
  )
}

function StrategyGrid({ strategies, onEdit }: { strategies: Strategy[], onEdit: (id: string) => void }) {
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
        <StrategyCard key={strategy.id} strategy={strategy} onEdit={onEdit} />
      ))}
    </div>
  )
}

function StrategyCard({ strategy, onEdit }: { strategy: Strategy, onEdit: (id: string) => void }) {
  const CategoryIcon = categoryIcons[strategy.category]
  const [isRunning, setIsRunning] = useState(false)

  const handleStart = () => {
    setIsRunning(true)
  }

  const handleStop = () => {
    setIsRunning(false)
  }

  return (
    <Card className="group overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-xl flex flex-col">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="rounded-xl bg-[#00E0AA]/10 p-2.5 shadow-sm">
              <CategoryIcon className="h-5 w-5 text-[#00E0AA]" />
            </div>
            {strategy.isDefault && (
              <Badge variant="secondary" className="gap-1 rounded-full text-xs">
                <Star className="h-3 w-3" />
                Default
              </Badge>
            )}
            {isRunning && (
              <Badge className="gap-1 rounded-full bg-green-600 text-xs hover:bg-green-600">
                <Activity className="h-3 w-3" />
                Running
              </Badge>
            )}
          </div>
          {strategy.lastModified && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {strategy.lastModified}
            </div>
          )}
        </div>
        <CardTitle className="text-lg font-semibold tracking-tight">{strategy.name}</CardTitle>
        <CardDescription className="line-clamp-2 text-sm">
          {strategy.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
          <span className="text-sm text-muted-foreground">Nodes:</span>
          <span className="text-sm font-semibold">{strategy.nodes}</span>
        </div>

        {strategy.performance && (
          <div className="space-y-3 rounded-2xl border border-border/50 bg-muted/20 p-4">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Performance</h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">ROI</div>
                <div className="text-base font-bold text-[#00E0AA]">
                  +{strategy.performance.roi}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">Trades</div>
                <div className="text-base font-bold">
                  {strategy.performance.trades}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
                <div className="text-base font-bold">
                  {strategy.performance.winRate}%
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t border-border/50 pt-4 flex flex-col gap-3">
        {/* Control Buttons */}
        <div className="flex gap-2 w-full">
          {!isRunning ? (
            <Button
              variant="default"
              className="flex-1 gap-2 rounded-xl bg-[#00E0AA] text-slate-950 shadow-sm hover:bg-[#00E0AA]/90"
              onClick={handleStart}
            >
              <Play className="h-4 w-4" />
              Start
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="flex-1 gap-2 rounded-xl"
              onClick={handleStop}
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          )}
          <Button variant="outline" className="flex-1 gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/60 hover:bg-[#00E0AA]/5" asChild>
            <Link href={`/strategies/${strategy.id}`}>
              <LineChart className="h-4 w-4" />
              Stats
            </Link>
          </Button>
        </div>

        {/* Edit and Other Actions */}
        <div className="flex gap-2 w-full">
          <Button
            variant="outline"
            className="flex-1 gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/60 hover:bg-[#00E0AA]/5"
            onClick={() => onEdit(strategy.id)}
          >
            <Edit className="h-4 w-4" />
            Edit Template
          </Button>
          {!strategy.isDefault && (
            <>
              <Button variant="outline" size="icon" className="rounded-xl border-border/60 transition hover:border-[#00E0AA]/60 hover:bg-[#00E0AA]/5">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="rounded-xl border-border/60 transition hover:border-red-500/60 hover:bg-red-500/5 hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
