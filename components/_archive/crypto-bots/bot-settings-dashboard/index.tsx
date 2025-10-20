"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Download, Plus, Save, Share2, Upload } from "lucide-react";
import { useState } from "react";
import { AdvancedTab } from "./components/bot-configuration/tabs/advanced-tab";
import { GeneralTab } from "./components/bot-configuration/tabs/general-tab";
import { RiskManagementTab } from "./components/bot-configuration/tabs/risk-management-tab";
import { StrategyTab } from "./components/bot-configuration/tabs/strategy-tab";
import { BotSelectionPanel } from "./components/bot-selection/bot-selection-panel";
import { CreateBotModal } from "./components/modals/create-bot-modal";
import { DeleteBotModal } from "./components/modals/delete-bot-modal";
import { ImportExportModal } from "./components/modals/import-export-modal";
import { mockActivityItems, mockPerformanceMetrics } from "./data";
import { useBotManagement } from "./hooks/use-bot-management";
import { useBotSettings } from "./hooks/use-bot-settings";
import type { BotConfig } from "./types";
import { filterBots } from "./utils";

export function BotSettingsDashboard() {
  const { settings, updateSetting, saveSettings, hasUnsavedChanges, isLoading: settingsLoading } = useBotSettings();
  const { bots, setBots, createBot, deleteBot, updateBotStatus, duplicateBot, isLoading: botLoading } = useBotManagement();

  const [selectedBot, setSelectedBot] = useState<string>("bot-1");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImportExportModal, setShowImportExportModal] = useState(false);
  const [botToDelete, setBotToDelete] = useState<BotConfig | null>(null);

  const filteredBots = filterBots(bots, searchQuery);
  const currentBot = bots.find((bot) => bot.id === selectedBot);

  const handleBotAction = async (action: "pause" | "resume" | "activate" | "delete") => {
    if (!currentBot) return;

    switch (action) {
      case "pause":
        await updateBotStatus(selectedBot, "paused");
        break;
      case "resume":
        await updateBotStatus(selectedBot, "active");
        break;
      case "activate":
        await updateBotStatus(selectedBot, "active");
        break;
      case "delete":
        setBotToDelete(currentBot);
        setShowDeleteModal(true);
        break;
    }
  };

  const handleSaveChanges = async () => {
    await saveSettings();
  };

  const handleShare = async () => {
    if (!currentBot) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(currentBot, null, 2));
      // Toast notification would be shown by the hook
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const handleDuplicate = async () => {
    if (!currentBot) return;

    const result = await duplicateBot(currentBot.id);
    if (result.success && result.bot) {
      setSelectedBot(result.bot.id);
    }
  };

  const handleImportBots = (importedBots: BotConfig[]) => {
    setBots((prev) => [...importedBots, ...prev]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bot Settings</h1>
          <p className="text-muted-foreground">Configure and manage your trading bots</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowImportExportModal(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImportExportModal(true)}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Bot
          </Button>
        </div>
      </div>

      <div className="max-lg:space-y-4 lg:grid gap-6 md:grid-cols-3">
        {/* Bot Selection Panel */}
        <BotSelectionPanel bots={filteredBots} selectedBot={selectedBot} searchQuery={searchQuery} onBotSelect={setSelectedBot} onSearchChange={setSearchQuery} />

        {/* Bot Configuration Panel */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-start gap-4 flex-wrap justify-between">
              <div>
                <h3 className="text-lg font-semibold">{currentBot?.name || "Select a Bot"}</h3>
                <p className="text-sm text-muted-foreground">{currentBot?.description}</p>
              </div>
              {currentBot && (
                <div className="flex items-center gap-2">
                  {currentBot.status === "active" ? (
                    <Button variant="outline" size="sm" onClick={() => handleBotAction("pause")}>
                      Pause
                    </Button>
                  ) : currentBot.status === "paused" ? (
                    <Button variant="outline" size="sm" onClick={() => handleBotAction("resume")}>
                      Resume
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleBotAction("activate")}>
                      Activate
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" onClick={() => handleBotAction("delete")}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {currentBot ? (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="overflow-x-auto ">
                  <TabsList className="gridc grid-cols-4 mb-4 min-w-[350px]">
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="strategy">Strategy</TabsTrigger>
                    <TabsTrigger value="risk">Risk Management</TabsTrigger>
                    <TabsTrigger value="advanced">Advanced</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="general">
                  <GeneralTab settings={settings} onUpdate={updateSetting} />
                </TabsContent>

                <TabsContent value="strategy">
                  <StrategyTab settings={settings} onUpdate={updateSetting} />
                </TabsContent>

                <TabsContent value="risk">
                  <RiskManagementTab settings={settings} onUpdate={updateSetting} />
                </TabsContent>

                <TabsContent value="advanced">
                  <AdvancedTab settings={settings} onUpdate={updateSetting} />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground">Select a bot from the list to configure its settings</p>
              </div>
            )}
          </CardContent>
          {currentBot && (
            <CardFooter className="flex justify-between flex-wrap gap-4 border-t p-4">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleShare}>
                  <Share2 className="mr-2 h-4 w-4" />
                  Share
                </Button>
                <Button variant="outline" size="sm" onClick={handleDuplicate}>
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveChanges} disabled={settingsLoading || !hasUnsavedChanges}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            </CardFooter>
          )}
        </Card>
      </div>

      {/* Performance and Activity sections */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Performance Metrics</h3>
            <p className="text-sm text-muted-foreground">Bot performance statistics</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Total Profit</p>
                <p className="text-2xl font-bold text-green-500">+${mockPerformanceMetrics.totalProfit}</p>
                <p className="text-sm text-muted-foreground">+{mockPerformanceMetrics.totalProfitPercentage}% ROI</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold">{mockPerformanceMetrics.winRate}%</p>
                <p className="text-sm text-muted-foreground">
                  {mockPerformanceMetrics.winningTrades}/{mockPerformanceMetrics.totalTrades} trades
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Recent Activity</h3>
            <p className="text-sm text-muted-foreground">Latest bot actions and trades</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mockActivityItems.slice(0, 3).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className={`p-2 rounded-md bg-${activity.color}-500/10 text-${activity.color}-500`}>
                    <div className="h-4 w-4" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="font-medium text-sm">{activity.title}</p>
                    <p className="text-xs text-muted-foreground">{activity.description}</p>
                    <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modals */}
      <CreateBotModal open={showCreateModal} onOpenChange={setShowCreateModal} onSubmit={createBot} isLoading={botLoading} />

      <DeleteBotModal open={showDeleteModal} onOpenChange={setShowDeleteModal} bot={botToDelete} onConfirm={deleteBot} isLoading={botLoading} />

      <ImportExportModal open={showImportExportModal} onOpenChange={setShowImportExportModal} bots={bots} onImport={handleImportBots} />
    </div>
  );
}
