"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Clock, Cpu, Power, RefreshCw } from "lucide-react";

interface HeaderProps {
  botRunning: boolean;
  isRefreshing: boolean;
  isFullscreen: boolean;
  onToggleBotStatus: () => void;
  onRefresh: () => void;
  onToggleFullscreen: () => void;
}

export function Header({ botRunning, isRefreshing, isFullscreen, onToggleBotStatus, onRefresh, onToggleFullscreen }: HeaderProps) {
  return (
    <>
      {/* Header section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-6 w-6" />
            <span>AI Trading Bot</span>
          </h1>
          <p className="text-muted-foreground">Advanced AI-powered trading with smart portfolio management</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={onRefresh} disabled={isRefreshing}>
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh data</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button variant={botRunning ? "destructive" : "default"} className="gap-2" onClick={onToggleBotStatus}>
            <Power className="h-4 w-4" />
            <span>{botRunning ? "Stop Bot" : "Start Bot"}</span>
          </Button>
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2 text-sm">
        <div className={cn("h-2 w-2 rounded-full", botRunning ? "bg-green-500" : "bg-red-500")} />
        <span>
          Status: <span className="font-medium">{botRunning ? "Active" : "Inactive"}</span>
        </span>

        {botRunning && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Running for: 3d 12h 45m</span>
          </>
        )}
      </div>
    </>
  );
}
