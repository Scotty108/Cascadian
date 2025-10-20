"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pause, Play, Plus, Sliders } from "lucide-react";
import { useState } from "react";
import type { GlobalBotStatus } from "../types";
import { GlobalSettingsModal } from "./modals/global-settings-modal";

interface GlobalControlsProps {
  globalBotStatus: GlobalBotStatus;
  onToggleGlobalStatus: () => void;
  onCreateBot: () => void;
}

export function GlobalControls({ globalBotStatus, onToggleGlobalStatus, onCreateBot }: GlobalControlsProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleSaveSettings = async (settings: any) => {
    // Here you would typically save the settings to your backend
    console.log("Saving global settings:", settings);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
  };

  return (
    <>
      <div className="flex flex-col flex-wrap sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Arbitrage Bot</h2>
          <Badge variant={globalBotStatus === "active" ? "default" : "outline"} className="px-2 py-0">
            {globalBotStatus === "active" ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
            {globalBotStatus === "active" ? "Running" : "Paused"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Button variant={globalBotStatus === "active" ? "outline" : "default"} size="sm" onClick={onToggleGlobalStatus} className="flex-1 sm:flex-none">
            {globalBotStatus === "active" ? (
              <>
                <Pause className="mr-1 h-4 w-4" /> Pause All
              </>
            ) : (
              <>
                <Play className="mr-1 h-4 w-4" /> Resume All
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsSettingsOpen(true)} className="flex-1 sm:flex-none">
            <Sliders className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Global Settings</span>
            <span className="sm:hidden">Settings</span>
          </Button>
          <Button variant="default" size="sm" onClick={onCreateBot} className="flex-1 sm:flex-none">
            <Plus className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">New Bot</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      <GlobalSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onSave={handleSaveSettings} />
    </>
  );
}
