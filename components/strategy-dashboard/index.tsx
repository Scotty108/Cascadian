"use client"

import { useState } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { Header } from "./components/header"
import { KpiCards } from "./components/kpi-cards"
import { PerformanceChart } from "./components/performance-chart"
import { PositionsSection } from "./components/positions-section"
import { RulesSection } from "./components/rules-section"
import { TradesSection } from "./components/trades-section"
import { WatchListSection } from "./components/watch-list-section"
import type { StrategyData } from "./types"
import { ACCENT_COLOR } from "./utils"

interface StrategyDashboardProps {
  strategyData: StrategyData
  onToggleStatus?: () => void
  onRefresh?: () => void
}

const PRIMARY_TABS = [
  { value: "overview", label: "Overview" },
  { value: "positions", label: "Positions" },
  { value: "watchlist", label: "Watch List" },
  { value: "trades", label: "Trades" },
  { value: "rules", label: "Rules" },
  { value: "settings", label: "Settings" },
] as const

export function StrategyDashboard({
  strategyData,
  onToggleStatus,
  onRefresh,
}: StrategyDashboardProps) {
  const [activeTab, setActiveTab] = useState<string>("overview")
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
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-border/40 bg-gradient-to-br from-background via-background to-background p-6 shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(circle at 15% 10%, rgba(0,224,170,0.18), transparent 45%), radial-gradient(circle at 88% 15%, rgba(0,224,170,0.12), transparent 40%)",
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <Header
            strategyId={strategyData.id}
            strategyName={strategyData.name}
            strategyDescription={strategyData.description}
            strategyRunning={strategyRunning}
            isRefreshing={isRefreshing}
            runTime="2d 15h 23m"
            onToggleStrategyStatus={handleToggleStatus}
            onRefresh={handleRefresh}
          />
        </div>
      </section>

      <KpiCards strategyData={strategyData} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          {PRIMARY_TABS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <PerformanceChart
            data={strategyData.performanceData}
            initialBalance={strategyData.initialBalance}
            currentBalance={strategyData.balance}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <PositionsSection positions={strategyData.positions} />
            <TradesSection trades={strategyData.recentTrades.slice(0, 6)} />
          </div>
        </TabsContent>

        <TabsContent value="positions">
          <PositionsSection positions={strategyData.positions} />
        </TabsContent>

        <TabsContent value="watchlist">
          <WatchListSection signals={strategyData.watchSignals} />
        </TabsContent>

        <TabsContent value="trades">
          <TradesSection trades={strategyData.recentTrades} />
        </TabsContent>

        <TabsContent value="rules">
          <RulesSection />
        </TabsContent>

        <TabsContent value="settings">
          <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/30 p-8 text-center text-muted-foreground">
            Strategy settings customisation coming soon.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
