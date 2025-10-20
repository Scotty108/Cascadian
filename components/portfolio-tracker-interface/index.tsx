"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioHeader } from "./components/header/portfolio-header"
import { PortfolioActions } from "./components/header/portfolio-actions"
import { KpiCards } from "./components/overview/kpi-cards"
import { PerformanceChart } from "./components/overview/performance-chart"
import { AllocationCharts } from "./components/overview/allocation-charts"
import { AssetsTab } from "./components/assets/assets-tab"
import { DeFiTab } from "./components/defi/defi-tab"
import { NFTsTab } from "./components/nfts/nfts-tab"
import { TransactionsTab } from "./components/transactions/transactions-tab"
import { AnalyticsTab } from "./components/analytics/analytics-tab"
import { AssetDetailsModal } from "./components/shared/asset-details-modal"
import { usePortfolio } from "./hooks/use-portfolio"
import type { Asset } from "./types"
import {
  portfolioOverviewData,
  assetAllocationData,
  chainAllocationData,
  protocolAllocationData,
  historicalPerformanceData,
} from "./data"

export function PortfolioTrackerInterface() {
  const {
    viewState,
    filters,
    settings,
    filteredAssets,
    filteredDeFiPositions,
    filteredTransactions,
    nftCollections,
    isRefreshing,
    lastRefresh,
    updateViewState,
    updateFilters,
    updateSettings,
    refreshData,
  } = usePortfolio()

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [showAssetDetails, setShowAssetDetails] = useState(false)

  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset)
    setShowAssetDetails(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <PortfolioHeader
        title="Portfolio Tracker"
        description="Track and analyze your crypto portfolio across multiple chains and protocols"
      />

      <KpiCards data={portfolioOverviewData} />

      <PortfolioActions
        viewState={viewState}
        onViewStateChange={updateViewState}
        settings={settings}
        onSettingsChange={updateSettings}
        isRefreshing={isRefreshing}
        onRefresh={refreshData}
        lastRefresh={lastRefresh}
      />

      <PerformanceChart data={historicalPerformanceData} />

      <AllocationCharts
        assetData={assetAllocationData}
        chainData={chainAllocationData}
        protocolData={protocolAllocationData}
      />

      <Tabs
        value={viewState.activeTab}
        onValueChange={(value) => updateViewState({ activeTab: value })}
        className="w-full"
      >
        <div className="overflow-x-auto">
        <TabsList className="min-w-[550px] justify-between">
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="defi">DeFi Positions</TabsTrigger>
          <TabsTrigger value="nfts">NFTs</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="assets">
          <AssetsTab
            assets={filteredAssets}
            filters={filters}
            onFiltersChange={updateFilters}
            onAssetClick={handleAssetClick}
          />
        </TabsContent>

        <TabsContent value="defi">
          <DeFiTab positions={filteredDeFiPositions} filters={filters} onFiltersChange={updateFilters} />
        </TabsContent>

        <TabsContent value="nfts">
          <NFTsTab collections={nftCollections}  />
        </TabsContent>

        <TabsContent value="transactions">
          <TransactionsTab transactions={filteredTransactions} filters={filters} onFiltersChange={updateFilters} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>

      <AssetDetailsModal open={showAssetDetails} onOpenChange={setShowAssetDetails} asset={selectedAsset} />
    </div>
  )
}
