"use client";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BarChart3, Bell, Clock, Star, Zap } from "lucide-react";
import { useEffect } from "react";

// Enhanced Hooks
import { useAdvancedFilters } from "./hooks/use-advanced-filters";
import { useAlertSystem } from "./hooks/use-alert-system";
import { usePumpScreener } from "./hooks/use-pump-screener";
import { useRealTimeData } from "./hooks/use-real-time-data";

// Header Components
import { FilterControls } from "./components/header/filter-controls";
import { ScreenerHeader } from "./components/header/screener-header";

// Advanced Components
import { AdvancedSearch } from "./components/advanced/advanced-search";
import { AlertManagement } from "./components/alerts/alert-management";

// Live Scanner Components
import { AlertDetailsCard } from "./components/live-scanner/alert-details-card";
import { MarketOverviewCard } from "./components/live-scanner/market-overview-card";
import { PumpAlertsTable } from "./components/live-scanner/pump-alerts-table";

// Watchlist Components
import { AlertSettings } from "./components/watchlist/alert-settings";
import { WatchlistTable } from "./components/watchlist/watchlist-table";
import { WatchlistTemplates } from "./components/watchlist/watchlist-templates";

// Historical Components
import { HistoricalPumpsTable } from "./components/historical/historical-pumps-table";
import { PumpPatterns } from "./components/historical/pump-patterns";
import { PumpStatistics } from "./components/historical/pump-statistics";
import { TopPerformingAssets } from "./components/historical/top-performing-assets";

// Market Overview Components
import { MarketPulse } from "./components/market-overview/market-pulse";
import { PumpPrediction } from "./components/market-overview/pump-prediction";
import { SocialTrends } from "./components/market-overview/social-trends";
import { UnusualActivity } from "./components/market-overview/unusual-activity";

export function PumpScreenerInterface() {
  const { activeTab, refreshing, fullscreen, selectedAlert, filterParams, watchlist, historicalPumps, setActiveTab, setSelectedAlert, handleRefresh, toggleFullscreen, updateFilterParams } =
    usePumpScreener();

  // Real-time data management
  const { alerts: realTimeAlerts, marketOverview, isConnected, lastUpdate, reconnect } = useRealTimeData();

  // Advanced filtering system
  const {
    filteredAlerts,
    searchQuery,
    sortBy,
    sortOrder,
    showFavorites,
    customFilters,
    favorites,
    filterStats,
    updateSearchQuery,
    updateSorting,
    updateCustomFilters,
    toggleFavorite,
    toggleShowFavorites,
    clearAllFilters,
  } = useAdvancedFilters(realTimeAlerts, filterParams);

  // Alert system management
  const {
    rules,
    notifications,
    unreadCount,
    soundEnabled,
    browserNotificationsEnabled,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    processAlerts,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
    setSoundEnabled,
    requestNotificationPermission,
  } = useAlertSystem();

  // Process new alerts through the alert system
  useEffect(() => {
    if (realTimeAlerts.length > 0) {
      processAlerts(realTimeAlerts);
    }
  }, [realTimeAlerts, processAlerts]);

  // Get selected alert details
  const selectedAlertDetails = selectedAlert !== null ? filteredAlerts.find((alert) => alert.id === selectedAlert) : null;

  return (
    <div className={cn("flex flex-col gap-6 transition-all duration-300", fullscreen ? "fixed inset-0 z-50 bg-background p-6 overflow-auto" : "")}>
      {/* Enhanced Header */}
      <div className="flex flex-col space-y-4">
        <ScreenerHeader
          refreshing={refreshing}
          fullscreen={fullscreen}
          isConnected={isConnected}
          lastUpdate={lastUpdate}
          unreadAlerts={unreadCount}
          onRefresh={handleRefresh}
          onToggleFullscreen={toggleFullscreen}
          onReconnect={reconnect}
        />

        {/* Advanced Search & Filters */}
        <AdvancedSearch
          searchQuery={searchQuery}
          onSearchChange={updateSearchQuery}
          customFilters={customFilters}
          onFiltersChange={updateCustomFilters}
          showFavorites={showFavorites}
          onToggleFavorites={toggleShowFavorites}
          filterStats={filterStats}
          onClearFilters={clearAllFilters}
        />

        {/* Basic Filter Controls */}
        <FilterControls filterParams={filterParams} onUpdateFilters={updateFilterParams} />
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <div className="overflow-x-auto">
          <TabsList className="w-fit min-w-[550px]  justify-between">
            <TabsTrigger value="live-scanner">
              <Zap className="mr-2 h-4 w-4" />
              Live Scanner
              {filteredAlerts.length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs flex items-center justify-center">
                  {filteredAlerts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="watchlist">
              <Star className="mr-2 h-4 w-4" />
              Watchlist
              {favorites.size > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 w-5 p-0 text-xs">
                  {favorites.size}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="historical">
              <Clock className="mr-2 h-4 w-4" />
              Historical
            </TabsTrigger>
            <TabsTrigger value="market-overview">
              <BarChart3 className="mr-2 h-4 w-4" />
              Market Overview
            </TabsTrigger>
            <TabsTrigger value="alerts">
              <Bell className="mr-2 h-4 w-4" />
              Alerts
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Live Scanner Tab */}
        <TabsContent value="live-scanner" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <MarketOverviewCard marketOverview={marketOverview} isConnected={isConnected} lastUpdate={lastUpdate} />
            <PumpAlertsTable
              alerts={filteredAlerts}
              selectedAlert={selectedAlert}
              onSelectAlert={setSelectedAlert}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onUpdateSorting={updateSorting}
            />
          </div>

          {/* Selected Alert Details */}
          {selectedAlertDetails && (
            <AlertDetailsCard alert={selectedAlertDetails} isFavorite={favorites.has(selectedAlertDetails.symbol)} onToggleFavorite={() => toggleFavorite(selectedAlertDetails.symbol)} />
          )}
        </TabsContent>

        {/* Watchlist Tab */}
        <TabsContent value="watchlist" className="space-y-6">
          <WatchlistTable watchlist={watchlist} favorites={favorites} onToggleFavorite={toggleFavorite} />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <AlertSettings />
            <WatchlistTemplates />
          </div>
        </TabsContent>

        {/* Historical Pumps Tab */}
        <TabsContent value="historical" className="space-y-6">
          <HistoricalPumpsTable pumps={historicalPumps} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            <PumpStatistics />
            <TopPerformingAssets />
            <PumpPatterns />
          </div>
        </TabsContent>

        {/* Market Overview Tab */}
        <TabsContent value="market-overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MarketPulse marketOverview={marketOverview} isConnected={isConnected} />
            <UnusualActivity />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <SocialTrends />
            <PumpPrediction />
          </div>
        </TabsContent>

        {/* Alert Management Tab */}
        <TabsContent value="alerts" className="space-y-6">
          <AlertManagement
            rules={rules}
            notifications={notifications}
            unreadCount={unreadCount}
            soundEnabled={soundEnabled}
            browserNotificationsEnabled={browserNotificationsEnabled}
            onCreateRule={createRule}
            onUpdateRule={updateRule}
            onDeleteRule={deleteRule}
            onToggleRule={toggleRule}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onClearAllNotifications={clearAllNotifications}
            onSetSoundEnabled={setSoundEnabled}
            onRequestNotificationPermission={requestNotificationPermission}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
