"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useState } from "react"
import { Header } from "./components/header"
import { KpiCards } from "./components/kpi-cards"
import { PositionsSection } from "./components/positions-section"
import { TradesSection } from "./components/trades-section"
import type { StrategyData } from "./types"

interface StrategyDashboardProps {
  strategyData: StrategyData
  onToggleStatus?: () => void
  onRefresh?: () => void
}

export function StrategyDashboard({
  strategyData,
  onToggleStatus,
  onRefresh,
}: StrategyDashboardProps) {
  const [activeTab, setActiveTab] = useState("overview")
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleToggleStatus = () => {
    onToggleStatus?.()
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await onRefresh?.()
    setTimeout(() => setIsRefreshing(false), 1000)
  }

  const strategyRunning = strategyData.status === "active"

  return (
    <div className="space-y-6">
      <Header
        strategyName={strategyData.name}
        strategyDescription={strategyData.description}
        strategyRunning={strategyRunning}
        isRefreshing={isRefreshing}
        runTime="2d 15h 23m"
        onToggleStrategyStatus={handleToggleStatus}
        onRefresh={handleRefresh}
      />

      <KpiCards strategyData={strategyData} />

      {/* Main content tabs */}
      <Tabs defaultValue="overview" onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="grid grid-cols-4 min-w-[400px] lg:w-[500px]">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <PositionsSection positions={strategyData.positions} />
            <TradesSection trades={strategyData.recentTrades.slice(0, 5)} />
          </div>
        </TabsContent>

        {/* Positions Tab */}
        <TabsContent value="positions" className="space-y-4">
          <PositionsSection positions={strategyData.positions} />
        </TabsContent>

        {/* Trades Tab */}
        <TabsContent value="trades" className="space-y-4">
          <TradesSection trades={strategyData.recentTrades} />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <div className="border rounded-lg p-6 text-center text-muted-foreground">
            Strategy settings coming soon...
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
