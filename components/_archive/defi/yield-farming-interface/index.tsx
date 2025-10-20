"use client";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PortfolioSummary } from "./components/header/portfolio-summary";
import { historicalApyData, portfolioAllocationData } from "./data";
import { useYieldFarming } from "./hooks/use-yield-farming";

// Enhanced components
import { PerformanceDashboard } from "./components/analytics/performance-dashboard";
import { YieldOptimization } from "./components/analytics/yield-optimization";
import { NotificationCenter } from "./components/notifications/notification-center";
import { TransactionHistory } from "./components/transactions/transaction-history";
import { WalletConnection } from "./components/wallet/wallet-connection";

// Tab components
import { TabNavigation } from "./components/tabs/tab-navigation";

// Filter components
import { FiltersPanel } from "./components/filters/filters-panel";

// Content components
import { FavoritesTable } from "./components/favorites/favorites-table";
import { MyFarmsGrid } from "./components/my-farms/my-farms-grid";
import { PortfolioAllocationChart } from "./components/my-farms/portfolio-allocation";
import { OpportunitiesTable } from "./components/opportunities/opportunities-table";

// Analytics components
import { HistoricalApyChart } from "./components/analytics/historical-apy-chart";
import { ImpermanentLossCalculator } from "./components/analytics/impermanent-loss-calculator";
import { ProtocolComparison } from "./components/analytics/protocol-comparison";

// Modal components
import { AdvancedSettingsModal } from "./components/modals/advanced-settings-modal";
import { OpportunityDetailModal } from "./components/modals/opportunity-detail-modal";

export function YieldFarmingInterface() {
  const {
    // Original state
    activeTab,
    filteredOpportunities,
    favoriteOpportunities,
    selectedOpportunity,
    showFilters,
    showImpermanentLossCalculator,
    showAdvancedSettings,
    gasOption,
    autocompoundEnabled,
    harvestThreshold,
    ilCalculatorValues,
    filters,
    totalPortfolioValue,
    totalRewards,
    userFarms,

    // Enhanced state
    walletState,
    transactionState,
    notifications,
    realTimeData,
    enhancedOpportunities,

    // Original actions
    setActiveTab,
    updateFilters,
    toggleFavorite,
    selectOpportunity,
    toggleFilters,
    toggleImpermanentLossCalculator,
    toggleAdvancedSettings,
    setGasOption,
    setAutocompoundEnabled,
    setHarvestThreshold,
    updateIlCalculatorValues,
    resetFilters,

    // Enhanced actions
    connectWallet,
    disconnectWallet,
    executeDeposit,
    executeWithdraw,
    executeHarvest,
    addNotification,
    markNotificationRead,
    clearNotifications,
  } = useYieldFarming();

  return (
    <div className="space-y-6">
      {/* Enhanced page header with wallet and notifications */}
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Yield Farming</h2>
          <p className="text-muted-foreground">Optimize your crypto assets with automated yield farming strategies</p>
          {realTimeData.lastUpdate && <p className="text-xs text-muted-foreground mt-1">Last updated: {realTimeData.lastUpdate.toLocaleTimeString()}</p>}
        </div>
        <div className="flex items-center space-x-2">
          <NotificationCenter
            notifications={notifications}
            onMarkRead={markNotificationRead}
            onClearAll={clearNotifications}
            onUpdateSettings={(settings) => {
            }}
          />
        </div>
      </div>

      {/* Wallet connection prompt */}
      {!walletState.isConnected && <WalletConnection walletState={walletState} onConnect={connectWallet} onDisconnect={disconnectWallet} />}

      {/* Portfolio summary cards - only show when wallet connected */}
      {walletState.isConnected && (
        <PortfolioSummary totalPortfolioValue={totalPortfolioValue} totalRewards={totalRewards} userFarms={userFarms} gasOption={gasOption} onGasOptionChange={setGasOption} />
      )}

      {/* Main content tabs */}
      <Tabs value={activeTab} className="space-y-4">
        <TabNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          searchQuery={filters.searchQuery}
          onSearchChange={(query) => updateFilters({ searchQuery: query })}
          showFilters={showFilters}
          onToggleFilters={toggleFilters}
        />

        {/* Filters panel */}
        {showFilters && <FiltersPanel filters={filters} onFiltersChange={updateFilters} onResetFilters={resetFilters} onClose={toggleFilters} />}

        {/* Tab contents */}
        <TabsContent value="all" className="space-y-4">
          <OpportunitiesTable
            opportunities={enhancedOpportunities}
            favoriteOpportunities={favoriteOpportunities}
            filters={filters}
            onFiltersChange={updateFilters}
            onToggleFavorite={toggleFavorite}
            onSelectOpportunity={selectOpportunity}
          />
        </TabsContent>

        <TabsContent value="my-farms" className="space-y-4">
          {walletState.isConnected ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">My Active Farms</h3>
               
              </div>

              <MyFarmsGrid userFarms={userFarms} onStartFarming={() => setActiveTab("all")} />

              {userFarms.length > 0 && (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <PortfolioAllocationChart portfolioData={portfolioAllocationData} totalPortfolioValue={totalPortfolioValue} totalRewards={totalRewards} userFarms={userFarms} />
                    <YieldOptimization opportunities={enhancedOpportunities} walletBalance={walletState.balance} currentPortfolioValue={totalPortfolioValue} />
                  </div>

                  <PerformanceDashboard userFarms={userFarms} totalPortfolioValue={totalPortfolioValue} totalRewards={totalRewards} />

                  <TransactionHistory transactionState={transactionState} />
                </>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Connect your wallet to view your farms</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="favorites" className="space-y-4">
          <FavoritesTable
            opportunities={filteredOpportunities}
            favoriteOpportunities={favoriteOpportunities}
            filters={filters}
            onFiltersChange={updateFilters}
            onToggleFavorite={toggleFavorite}
            onSelectOpportunity={selectOpportunity}
            onBrowseFarms={() => setActiveTab("all")}
          />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <HistoricalApyChart data={historicalApyData} />
            <ImpermanentLossCalculator values={ilCalculatorValues} onValuesChange={updateIlCalculatorValues} />
          </div>

          <YieldOptimization opportunities={enhancedOpportunities} walletBalance={walletState.balance} currentPortfolioValue={totalPortfolioValue} />

          <ProtocolComparison />

          {walletState.isConnected && userFarms.length > 0 && <PerformanceDashboard userFarms={userFarms} totalPortfolioValue={totalPortfolioValue} totalRewards={totalRewards} />}
        </TabsContent>
      </Tabs>

      {/* Enhanced opportunity detail modal */}
      {selectedOpportunity && (
        <OpportunityDetailModal
          opportunity={selectedOpportunity}
          gasOption={gasOption}
          autocompoundEnabled={autocompoundEnabled}
          harvestThreshold={harvestThreshold}
          onClose={() => selectOpportunity(null)}
          onGasOptionChange={setGasOption}
          onAutocompoundChange={setAutocompoundEnabled}
          onHarvestThresholdChange={setHarvestThreshold}
          onOpenIlCalculator={toggleImpermanentLossCalculator}
          onDeposit={(amount) => executeDeposit(selectedOpportunity.id, amount)}
          walletConnected={walletState.isConnected}
          walletBalance={walletState.balance}
        />
      )}

      {/* Advanced settings modal */}
      {showAdvancedSettings && (
        <AdvancedSettingsModal
          gasOption={gasOption}
          autocompoundEnabled={autocompoundEnabled}
          onClose={toggleAdvancedSettings}
          onGasOptionChange={setGasOption}
          onAutocompoundChange={setAutocompoundEnabled}
        />
      )}
    </div>
  );
}
