"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Bell, Download, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";
import type { ViewState } from "../../types";
import { ExportModal } from "../modals/export-modal";
import { SettingsModal, type PortfolioSettings } from "../modals/settings-modal";

interface PortfolioActionsProps {
  viewState: ViewState;
  onViewStateChange: (updates: Partial<ViewState>) => void;
  settings: PortfolioSettings;
  onSettingsChange: (settings: PortfolioSettings) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  lastRefresh: Date;
}

export function PortfolioActions({ viewState, onViewStateChange, settings, onSettingsChange, isRefreshing, onRefresh, lastRefresh }: PortfolioActionsProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const handleAlertsClick = () => {
    toast({
      title: "Alerts",
      description: "Alert management feature coming soon!",
    });
  };

  const formatLastRefresh = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return "Just now";
    if (minutes === 1) return "1 minute ago";
    if (minutes < 60) return `${minutes} minutes ago`;

    const hours = Math.floor(minutes / 60);
    if (hours === 1) return "1 hour ago";
    if (hours < 24) return `${hours} hours ago`;

    return date.toLocaleDateString();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={handleAlertsClick}>
            <Bell className="mr-2 h-4 w-4" />
            Alerts
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-xs text-muted-foreground">Last updated: {formatLastRefresh(lastRefresh)}</div>

          <Select value={viewState.timeRange} onValueChange={(value) => onViewStateChange({ timeRange: value })}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1D">1 Day</SelectItem>
              <SelectItem value="1W">1 Week</SelectItem>
              <SelectItem value="1M">1 Month</SelectItem>
              <SelectItem value="3M">3 Months</SelectItem>
              <SelectItem value="6M">6 Months</SelectItem>
              <SelectItem value="1Y">1 Year</SelectItem>
              <SelectItem value="ALL">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} settings={settings} onSettingsChange={onSettingsChange} />

      <ExportModal open={showExport} onOpenChange={setShowExport} />
    </>
  );
}
