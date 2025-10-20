"use client";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";
import { MarketDepthAnalysis } from "./components/analytics/market-depth-analysis";
import { ImpermanentLossCalculator } from "./components/calculator/impermanent-loss-calculator";
import { LiquidityCalculator } from "./components/calculator/liquidity-calculator";
import { AdvancedFilters } from "./components/filters/advanced-filters";
import { PageHeader } from "./components/header/page-header";
import { LiquidityOverviewChart } from "./components/overview/liquidity-overview-chart";
import { OverviewStats } from "./components/overview/overview-stats";
import { ProtocolDistributionChart } from "./components/overview/protocol-distribution-chart";
import { PoolsTable } from "./components/pools/pools-table";
import { PositionsStats } from "./components/positions/positions-stats";
import { PositionsTable } from "./components/positions/positions-table";
import { myLiquidityPositions, topLiquidityPools } from "./data";
import { useLiquidityTracker } from "./hooks/use-liquidity-tracker";

export function LiquidityTrackerInterface() {
  const { state, updateFilters, updateCalculator, setActiveTab, toggleAdvancedFilters, resetFilters, filteredPools, portfolioMetrics } = useLiquidityTracker();

  const [searchTerm, setSearchTerm] = useState("");

  const searchFilteredPools = filteredPools.filter((pool) => pool.name.toLowerCase().includes(searchTerm.toLowerCase()) || pool.protocol.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className=" p-4 space-y-6">
      <PageHeader
        selectedChain={state.filters.selectedChain}
        selectedProtocol={state.filters.selectedProtocol}
        timeRange={state.filters.timeRange}
        onChainChange={(value) => updateFilters({ selectedChain: value })}
        onProtocolChange={(value) => updateFilters({ selectedProtocol: value })}
        onTimeRangeChange={(value) => updateFilters({ timeRange: value })}
        onToggleAdvancedFilters={toggleAdvancedFilters}
      />

      <AdvancedFilters filters={state.filters} onUpdateFilters={updateFilters} onResetFilters={resetFilters} />

      <Tabs value={state.activeTab} onValueChange={setActiveTab}>
        <TabsContent value="overview" className="space-y-4">
          <OverviewStats />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <LiquidityOverviewChart />
            <ProtocolDistributionChart />
          </div>

          <PoolsTable pools={topLiquidityPools} searchTerm="" onSearchChange={() => {}} />
        </TabsContent>

        <TabsContent value="pools" className="space-y-4">
          <PoolsTable pools={searchFilteredPools} searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        </TabsContent>

        <TabsContent value="my-positions" className="space-y-4">
          <PositionsStats totalValue={portfolioMetrics.totalCurrentValue} totalRewards={portfolioMetrics.totalRewards} averageApy={portfolioMetrics.averageApy} />

          <PositionsTable positions={myLiquidityPositions} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <MarketDepthAnalysis />
        </TabsContent>

        <TabsContent value="calculator" className="space-y-4">
          <LiquidityCalculator calculator={state.calculator} onUpdateCalculator={updateCalculator} />

          <ImpermanentLossCalculator />
        </TabsContent>
      </Tabs>
    </div>
  );
}
