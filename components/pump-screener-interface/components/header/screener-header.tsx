"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bell, RefreshCw, Wifi, WifiOff } from "lucide-react";

interface ScreenerHeaderProps {
  refreshing: boolean;
  fullscreen: boolean;
  isConnected: boolean;
  lastUpdate: number;
  unreadAlerts: number;
  onRefresh: () => void;
  onToggleFullscreen: () => void;
  onReconnect: () => void;
}

export function ScreenerHeader({ refreshing, fullscreen, isConnected, lastUpdate, unreadAlerts, onRefresh, onToggleFullscreen, onReconnect }: ScreenerHeaderProps) {
  const formatLastUpdate = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  return (
    <div className="flex gap-4 flex-wrap items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pump Screener</h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Detect and analyze cryptocurrency pump patterns in real-time</span>
          <div className="flex items-center gap-1">
            {isConnected ? <Wifi className="h-3 w-3 text-green-500" /> : <WifiOff className="h-3 w-3 text-red-500" />}
            <span className="text-xs">{isConnected ? `Updated ${formatLastUpdate(lastUpdate)}` : "Disconnected"}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={isConnected ? onRefresh : onReconnect} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4", refreshing ? "animate-spin" : "")} />
          <span className="sr-only">{isConnected ? "Refresh" : "Reconnect"}</span>
        </Button>

        <Button className="relative">
          <Bell className="mr-2 h-4 w-4" />
          Set Alerts
          {unreadAlerts > 0 && (
            <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 p-0 text-xs">
              {unreadAlerts}
            </Badge>
          )}
        </Button>
      </div>
    </div>
  );
}
