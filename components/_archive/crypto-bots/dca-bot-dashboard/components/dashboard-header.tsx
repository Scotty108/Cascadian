"use client";

import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

interface DashboardHeaderProps {
  onCreateBot: () => void;
  onRefresh: () => void;
  onSettings: () => void;
}

export function DashboardHeader({ onCreateBot, onRefresh, onSettings }: DashboardHeaderProps) {
  return (
    <div className="flex flex-col flex-wrap gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DCA Bot</h1>
        <p className="text-muted-foreground">Automate your dollar cost averaging strategy for consistent crypto investments</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </div>
    </div>
  );
}
