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
import { OrchestratorDecisionsSection } from "./components/orchestrator-decisions-section"
import { DeploymentHistorySection } from "./components/deployment-history-section"
import { CopyTradingSection } from "./components/copy-trading-section"
import type { StrategyData } from "./types"

interface StrategyDashboardProps {
  strategyData: StrategyData
  onToggleStatus?: () => void
  onRefresh?: () => void
}

const PRIMARY_TABS = [
  { value: "overview", label: "Overview" },
  { value: "positions", label: "Positions" },
  { value: "copytrading", label: "Copy Trading" },
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
      {/* Hero Header Section with Gradient */}
      <section className="relative overflow-hidden rounded-3xl border border-border/40 bg-gradient-to-br from-background via-background to-background shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at 15% 10%, rgba(0,224,170,0.18), transparent 45%), radial-gradient(circle at 88% 15%, rgba(0,224,170,0.12), transparent 40%)",
          }}
          aria-hidden="true"
        />
        <div className="relative p-6 sm:p-8">
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

      {/* KPI Cards */}
      <KpiCards strategyData={strategyData} />

      {/* Tabbed Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="inline-flex h-11 items-center justify-center rounded-xl bg-muted p-1 text-muted-foreground">
          {PRIMARY_TABS.map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          <PerformanceChart
            data={strategyData.performanceData}
            initialBalance={strategyData.initialBalance}
            currentBalance={strategyData.balance}
          />
          <OrchestratorDecisionsSection workflowId={strategyData.id} />
          <div className="grid gap-6 lg:grid-cols-2">
            <PositionsSection positions={strategyData.positions} />
            <TradesSection trades={strategyData.recentTrades.slice(0, 6)} />
          </div>
        </TabsContent>

        <TabsContent value="positions" className="mt-6">
          <PositionsSection positions={strategyData.positions} />
        </TabsContent>

        <TabsContent value="copytrading" className="mt-6">
          <CopyTradingSection strategyId={strategyData.id} />
        </TabsContent>

        <TabsContent value="watchlist" className="mt-6">
          <WatchListSection signals={strategyData.watchSignals} />
        </TabsContent>

        <TabsContent value="trades" className="mt-6">
          <TradesSection trades={strategyData.recentTrades} />
        </TabsContent>

        <TabsContent value="rules" className="mt-6">
          <RulesSection nodeGraph={strategyData.nodeGraph} />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <DeploymentHistorySection strategyId={strategyData.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
