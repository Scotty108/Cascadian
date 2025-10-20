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
  LineChart
} from "lucide-react"
import { useState } from "react"

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
}

const defaultStrategies: Strategy[] = [
  {
    id: "default-template",
    name: "Default Template",
    description: "The standard cascadian intelligence trading strategy",
    type: "default",
    category: "ai",
    nodes: 10,
    isDefault: true,
    performance: {
      roi: 12.5,
      trades: 48,
      winRate: 75
    }
  }
]

const customStrategies: Strategy[] = []

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

  const allStrategies = [...defaultStrategies, ...customStrategies]

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
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              Strategy Library
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create, edit, and manage your trading strategies
            </p>
          </div>
          <Button onClick={onCreateNew} size="lg" className="gap-2">
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
            className="pl-10"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="border-b border-border px-6">
          <TabsList className="bg-transparent h-auto p-0">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-3"
            >
              All Strategies ({allStrategies.length})
            </TabsTrigger>
            <TabsTrigger
              value="default"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-3"
            >
              Default Templates ({defaultStrategies.length})
            </TabsTrigger>
            <TabsTrigger
              value="custom"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-3"
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
    </div>
  )
}

function StrategyGrid({ strategies, onEdit }: { strategies: Strategy[], onEdit: (id: string) => void }) {
  if (strategies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No strategies found</h3>
        <p className="text-sm text-muted-foreground">
          Try adjusting your search or create a new strategy
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
    <Card className="group hover:shadow-lg transition-shadow duration-200 flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <CategoryIcon className="h-4 w-4 text-primary" />
            </div>
            {strategy.isDefault && (
              <Badge variant="secondary" className="text-xs">
                <Star className="h-3 w-3 mr-1" />
                Default
              </Badge>
            )}
            {isRunning && (
              <Badge className="text-xs bg-green-600">
                <Activity className="h-3 w-3 mr-1" />
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
        <CardTitle className="text-lg">{strategy.name}</CardTitle>
        <CardDescription className="line-clamp-2">
          {strategy.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Nodes:</span>
            <span className="font-medium">{strategy.nodes}</span>
          </div>

          {strategy.performance && (
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">ROI</div>
                <div className="text-sm font-semibold text-green-600">
                  +{strategy.performance.roi}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">Trades</div>
                <div className="text-sm font-semibold">
                  {strategy.performance.trades}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
                <div className="text-sm font-semibold">
                  {strategy.performance.winRate}%
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="pt-4 border-t border-border flex flex-col gap-2">
        {/* Control Buttons */}
        <div className="flex gap-2 w-full">
          {!isRunning ? (
            <Button
              variant="default"
              className="flex-1"
              onClick={handleStart}
            >
              <Play className="h-4 w-4 mr-2" />
              Start
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleStop}
            >
              <Square className="h-4 w-4 mr-2" />
              Stop
            </Button>
          )}
          <Button variant="outline" className="flex-1">
            <LineChart className="h-4 w-4 mr-2" />
            Stats
          </Button>
        </div>

        {/* Edit and Other Actions */}
        <div className="flex gap-2 w-full">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onEdit(strategy.id)}
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit Template
          </Button>
          {!strategy.isDefault && (
            <>
              <Button variant="outline" size="icon">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
