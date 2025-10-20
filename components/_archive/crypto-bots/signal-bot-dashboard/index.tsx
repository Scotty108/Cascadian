"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, LucideLineChart, Settings, Signal, Users } from "lucide-react";
import { chartData, dailyPerformanceData, mockRecentSignals, mockSignalHistory, mockSignalProviders, performanceStats, weeklyPerformanceData } from "./data";
import { useSignalBot } from "./hooks/use-signal-bot";

// Components
import { DashboardHeader } from "./components/dashboard-header";
import { HistoryTab } from "./components/history-tab";
import { OverviewTab } from "./components/overview-tab";
import { ProvidersTab } from "./components/providers-tab";
import { SettingsTab } from "./components/settings-tab";
import { SignalsTab } from "./components/signals-tab";
import { StatusCards } from "./components/status-cards";

// Modals
import { AddProviderModal } from "./components/modals/add-provider-modal";
import { AdvancedSettingsModal } from "./components/modals/advanced-settings-modal";
import { ProviderDetailsModal } from "./components/modals/provider-details-modal";

export function SignalBotDashboard() {
  const {
    // State
    botActive,
    autoTrade,
    riskLevel,
    notificationSettings,
    signalFilters,
    tradingSettings,
    advancedSettings,
    showAdvancedSettings,
    showAddProvider,
    showProviderDetails,
    historyFilter,

    // Actions
    setBotActive,
    setAutoTrade,
    setRiskLevel,
    setShowAdvancedSettings,
    setShowAddProvider,
    setShowProviderDetails,
    setHistoryFilter,
    updateNotificationSetting,
    updateSignalFilter,
    updateTradingSetting,
    updateAdvancedSetting,
    resetFilters,
    resetSettings,
  } = useSignalBot();

  const handleToggleBot = () => setBotActive(!botActive);

  const handleSaveAdvancedSettings = () => {
    setShowAdvancedSettings(false);
    // Implement save logic
  };

  const handleAddProvider = (providerData: any) => {
    // Implement add provider logic
    console.log("Adding provider:", providerData);
  };

  const handleToggleFavorite = (providerId: string) => {
    // Implement toggle favorite logic
    console.log("Toggling favorite for provider:", providerId);
  };

  const handleToggleProviderStatus = (providerId: string) => {
    // Implement toggle provider status logic
    console.log("Toggling status for provider:", providerId);
  };

  const handleApplyFilters = () => {
    // Implement apply filters logic
    console.log("Applying filters:", signalFilters);
  };

  const handleSaveSettings = () => {
    // Implement save settings logic
    console.log("Saving settings...");
  };

  const handleExportHistory = () => {
    // Implement export logic
    console.log("Exporting history...");
  };

  const selectedProvider = showProviderDetails ? mockSignalProviders.find((p) => p.id === showProviderDetails) || null : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <DashboardHeader botActive={botActive} onToggleBot={handleToggleBot} />

      {/* Status Cards */}
      <StatusCards botActive={botActive} performanceStats={performanceStats} />

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4 ">
        <div className="overflow-x-auto">
          <TabsList className="min-w-[450px] justify-start overflow-x-auto w-fit">
            <TabsTrigger value="overview" className="gap-2">
              <LucideLineChart className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="signals" className="gap-2">
              <Signal className="h-4 w-4" />
              <span>Signals</span>
            </TabsTrigger>
            <TabsTrigger value="providers" className="gap-2">
              <Users className="h-4 w-4" />
              <span>Providers</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              <span>History</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <OverviewTab
            performanceStats={performanceStats}
            recentSignals={mockRecentSignals}
            autoTrade={autoTrade}
            riskLevel={riskLevel}
            chartData={chartData}
            onAutoTradeChange={setAutoTrade}
            onRiskLevelChange={setRiskLevel}
            onShowAdvancedSettings={() => setShowAdvancedSettings(true)}
          />
        </TabsContent>

        {/* Signals Tab */}
        <TabsContent value="signals">
          <SignalsTab
          // signals={mockRecentSignals}
          // signalFilters={signalFilters}
          // onUpdateFilter={updateSignalFilter}
          // onResetFilters={resetFilters}
          // onApplyFilters={handleApplyFilters}
          />
        </TabsContent>

        {/* Providers Tab */}
        <TabsContent value="providers">
          <ProvidersTab
            providers={mockSignalProviders}
            onAddProvider={() => setShowAddProvider(true)}
            onToggleFavorite={handleToggleFavorite}
            onToggleStatus={handleToggleProviderStatus}
            onViewDetails={setShowProviderDetails}
          />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <SettingsTab
            notificationSettings={notificationSettings}
            tradingSettings={tradingSettings}
            onUpdateNotification={updateNotificationSetting}
            onUpdateTrading={updateTradingSetting}
            onResetSettings={resetSettings}
            onSaveSettings={handleSaveSettings}
          />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <HistoryTab signalHistory={mockSignalHistory} historyFilter={historyFilter} weeklyPerformanceData={weeklyPerformanceData} onFilterChange={setHistoryFilter} onExport={handleExportHistory} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AdvancedSettingsModal
        isOpen={showAdvancedSettings}
        advancedSettings={advancedSettings}
        onClose={() => setShowAdvancedSettings(false)}
        onSave={handleSaveAdvancedSettings}
        onUpdateSetting={updateAdvancedSetting}
      />

      <AddProviderModal isOpen={showAddProvider} onClose={() => setShowAddProvider(false)} onAdd={handleAddProvider} />

      <ProviderDetailsModal
        isOpen={!!showProviderDetails}
        provider={selectedProvider}
        recentSignals={mockRecentSignals}
        dailyPerformanceData={dailyPerformanceData}
        onClose={() => setShowProviderDetails(null)}
      />
    </div>
  );
}
