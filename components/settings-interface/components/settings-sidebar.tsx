"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";
import type React from "react";
import { SETTINGS_TABS } from "../constants";

interface SettingsSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  hasUnsavedChanges: boolean;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeTab, onTabChange, hasUnsavedChanges }) => {
  return (
    <div className="md:w-64 md:border-r bg-muted/10">
      <div className="p-4">
        <h2 className="text-lg font-semibold">Settings</h2>
        {hasUnsavedChanges && <p className="text-sm text-orange-600 mt-1">You have unsaved changes</p>}
      </div>
      <div className="h-[calc(100vh-8rem)]">
        <div className="p-2 space-y-1">
          {SETTINGS_TABS.map((tab) => {
            const IconComponent = Icons[tab.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;

            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "secondary" : "ghost"}
                className={cn("w-full justify-start text-left h-auto p-3", activeTab === tab.id && "bg-secondary")}
                onClick={() => onTabChange(tab.id)}
              >
                <div className="flex items-start space-x-3">
                  <IconComponent className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{tab.label}</div>
                    <div className="text-xs text-muted-foreground mt-1 whitespace-normal line-clamp-2">{tab.description}</div>
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
