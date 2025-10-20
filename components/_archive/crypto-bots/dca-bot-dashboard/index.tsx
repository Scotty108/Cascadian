"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardHeader } from "./components/dashboard-header"
import { StatsOverview } from "./components/stats-overview"
import { OverviewTab } from "./components/overview-tab"
import { BotsTab } from "./components/bots-tab"
import { HistoryTab } from "./components/history-tab"
import { SettingsTab } from "./components/settings-tab"
import { EditBotModal } from "./components/modals/edit-bot-modal"
import { BotDetailsModal } from "./components/modals/bot-details-modal"
import { SettingsModal } from "./components/modals/settings-modal"
import { useDcaBot } from "./hooks/use-dca-bot"
import { calculateStats } from "./utils"

export function DcaBotDashboard() {
  const {
    bots,
    selectedBot,
    activeTab,
    isCreatingBot,
    showEditModal,
    showDetailsModal,
    showSettingsModal,
    editingBot,
    viewingBot,
    formData,
    settings,
    setActiveTab,
    setShowEditModal,
    setShowDetailsModal,
    setShowSettingsModal,
    toggleBotStatus,
    handleCreateBot,
    handleCancelCreate,
    handleSaveBot,
    handleEditBot,
    handleSaveEditBot,
    handleViewDetails,
    handleCopyBot,
    handleDeleteBot,
    updateFormData,
    updateSettings,
    setSelectedBot,
  } = useDcaBot()

  const stats = calculateStats(bots)

  const handleRefresh = () => {
    // Implement refresh logic
    console.log("Refreshing data...")
  }

  const handleSettings = () => {
    setShowSettingsModal(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <DashboardHeader onCreateBot={handleCreateBot} onRefresh={handleRefresh} onSettings={handleSettings} />

      {/* Stats Overview */}
      <StatsOverview stats={stats} />

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="bots">My DCA Bots</TabsTrigger>
          <TabsTrigger value="history">Purchase History</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab
            bots={bots}
            selectedBot={selectedBot}
            onViewDetails={handleViewDetails}
            onEditBot={handleEditBot}
            onToggleStatus={toggleBotStatus}
            onSelectBot={setSelectedBot}
          />
        </TabsContent>

        <TabsContent value="bots" className="space-y-4">
          <BotsTab
            bots={bots}
            onEditBot={handleEditBot}
            onToggleStatus={toggleBotStatus}
            onCopyBot={handleCopyBot}
            onDeleteBot={handleDeleteBot}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <HistoryTab bots={bots} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SettingsTab
            isCreatingBot={isCreatingBot}
            formData={formData}
            settings={settings}
            onUpdateFormData={updateFormData}
            onUpdateSettings={updateSettings}
            onSaveBot={handleSaveBot}
            onCancelCreate={handleCancelCreate}
          />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <EditBotModal
        bot={editingBot}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveEditBot}
      />

      <BotDetailsModal
        bot={viewingBot}
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        onEdit={handleEditBot}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        settings={settings}
        onClose={() => setShowSettingsModal(false)}
        onUpdateSettings={updateSettings}
      />
    </div>
  )
}
