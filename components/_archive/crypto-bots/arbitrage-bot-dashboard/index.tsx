"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Loader2 } from "lucide-react";
import { BotsTab } from "./components/bots-tab";
import { ExchangesTab } from "./components/exchanges-tab";
import { GlobalControls } from "./components/global-controls";
import { HeaderStats } from "./components/header-stats";
import { CreateBotModal } from "./components/modals/create-bot-modal";
import { OpportunitiesTab } from "./components/opportunities-tab";
import { OverviewTab } from "./components/overview-tab";
import { useArbitrageDashboard } from "./hooks/use-arbitrage-dashboard";

export function ArbitrageBotDashboard() {
  const {
    // State
    globalBotStatus,
    isCreatingBot,
    selectedBot,
    isLoading,
    error,

    // Filtered data
    activeOpportunities,
    completedOpportunities,
    failedOpportunities,
    activeBots,
    pausedBots,
    stoppedBots,
    connectedExchanges,
    disconnectedExchanges,
    allBots,
    allOpportunities,
    allExchanges,

    // Actions
    setIsCreatingBot,
    setSelectedBotId,
    executeOpportunity,
    pauseBot,
    resumeBot,
    deleteBot,
    createBot,
    connectExchange,
    disconnectExchange,
    toggleGlobalBotStatus,
    clearError,
    refreshData,
  } = useArbitrageDashboard();

  return (
    <div className="space-y-6">
      {/* Global Loading Indicator */}
      {isLoading && (
        <div className="fixed top-4 right-4 z-50">
          <div className="flex items-center gap-2 rounded-md bg-background border px-3 py-2 shadow-md">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Processing...</span>
          </div>
        </div>
      )}

      {/* Global Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            {error}
            <button onClick={clearError} className="text-sm underline">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Header Stats */}
      <HeaderStats activeOpportunitiesCount={activeOpportunities.length} activeBotsCount={activeBots.length} totalBotsCount={allBots.length} />

      {/* Global Controls */}
      <GlobalControls globalBotStatus={globalBotStatus} onToggleGlobalStatus={toggleGlobalBotStatus} onCreateBot={() => setIsCreatingBot(true)} />

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full overflow-x-auto justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="bots">My Bots</TabsTrigger>
          <TabsTrigger value="exchanges">Exchanges</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab activeBots={activeBots} activeOpportunities={activeOpportunities} onCreateBot={() => setIsCreatingBot(true)} onExecuteOpportunity={executeOpportunity} />
        </TabsContent>

        <TabsContent value="opportunities" className="space-y-4">
          <OpportunitiesTab
            activeOpportunities={activeOpportunities}
            completedOpportunities={completedOpportunities}
            failedOpportunities={failedOpportunities}
            onExecuteOpportunity={executeOpportunity}
          />
        </TabsContent>

        <TabsContent value="bots" className="space-y-4">
          <BotsTab
            activeBots={activeBots}
            pausedBots={pausedBots}
            stoppedBots={stoppedBots}
            allBots={allBots}
            onCreateBot={() => setIsCreatingBot(true)}
            onPauseBot={pauseBot}
            onResumeBot={resumeBot}
            onDeleteBot={deleteBot}
            onSelectBot={setSelectedBotId}
            isLoading={isLoading}
            error={error}
          />
        </TabsContent>

        <TabsContent value="exchanges" className="space-y-4">
          <ExchangesTab
            connectedExchanges={connectedExchanges}
            disconnectedExchanges={disconnectedExchanges}
            allExchanges={allExchanges}
            onConnectExchange={connectExchange}
            onDisconnectExchange={disconnectExchange}
          />
        </TabsContent>
      </Tabs>

      {/* Create Bot Modal */}
      <CreateBotModal isOpen={isCreatingBot} exchanges={allExchanges} onClose={() => setIsCreatingBot(false)} onCreateBot={createBot} />

      {/* Bot Details Modal */}
    </div>
  );
}
