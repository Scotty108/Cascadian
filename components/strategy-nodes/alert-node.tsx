/**
 * ALERT NODE
 *
 * Shows alerts from copy trade activity.
 * Displays consensus triggers, position changes, and important events.
 */

"use client"

import { memo, useEffect, useState, useCallback } from "react"
import { Handle, Position } from "@xyflow/react"
import {
  Bell,
  BellRing,
  CheckCircle,
  AlertTriangle,
  Info,
  X,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react"
import type { CopyTradeAlert } from "@/lib/copytrade/alertStore"

// ============================================================================
// Types
// ============================================================================

interface AlertNodeProps {
  data: {
    config?: {
      soundEnabled?: boolean;
      maxDisplayed?: number;
      priorityFilter?: string[];
    };
    status?: "idle" | "active";
  };
  selected?: boolean;
  id: string;
}

// ============================================================================
// Component
// ============================================================================

function AlertNode({ data, selected }: AlertNodeProps) {
  const config = data.config || {};
  const maxDisplay = config.maxDisplayed || 5;

  const [alerts, setAlerts] = useState<CopyTradeAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(config.soundEnabled ?? false);

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/copytrade/alerts?limit=20");
      const result = await response.json();
      if (result.success) {
        setAlerts(result.data.alerts);
        setUnreadCount(result.data.unreadCount);
      }
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/copytrade/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      fetchAlerts();
    } catch (err) {
      console.error("Failed to mark alerts read:", err);
    }
  }, [fetchAlerts]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "critical":
        return <AlertTriangle className="h-3 w-3 text-red-500" />;
      case "high":
        return <BellRing className="h-3 w-3 text-orange-500" />;
      case "medium":
        return <Bell className="h-3 w-3 text-yellow-500" />;
      default:
        return <Info className="h-3 w-3 text-blue-500" />;
    }
  };

  const getPriorityBg = (priority: string) => {
    switch (priority) {
      case "critical":
        return "bg-red-500/10 border-red-500/20";
      case "high":
        return "bg-orange-500/10 border-orange-500/20";
      case "medium":
        return "bg-yellow-500/10 border-yellow-500/20";
      default:
        return "bg-blue-500/10 border-blue-500/20";
    }
  };

  const displayAlerts = alerts.slice(0, maxDisplay);
  const hasAlerts = alerts.length > 0;
  const hasUnread = unreadCount > 0;

  return (
    <div
      data-testid="alert-node"
      className={`rounded-2xl border-2 ${
        hasUnread ? "border-yellow-500 bg-yellow-500/5" : "border-border"
      } ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-yellow-500/10 to-amber-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[300px] max-w-[340px] antialiased`}
      style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-1.5 ${hasUnread ? "bg-yellow-500/30 animate-pulse" : "bg-yellow-500/20"}`}>
              {hasUnread ? (
                <BellRing className="h-4 w-4 text-yellow-600" />
              ) : (
                <Bell className="h-4 w-4 text-yellow-500" />
              )}
            </div>
            <div className="font-semibold text-sm">Alerts</div>
            {unreadCount > 0 && (
              <div className="px-1.5 py-0.5 rounded-full text-xs font-bold bg-yellow-500 text-white">
                {unreadCount}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1 rounded hover:bg-muted/50 transition-colors"
              title={soundEnabled ? "Mute" : "Unmute"}
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-yellow-600" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
            <button
              onClick={fetchAlerts}
              disabled={isLoading}
              className="p-1 rounded hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Alerts List */}
      <div className="px-4 py-3 space-y-2">
        {!hasAlerts ? (
          <div className="text-xs text-muted-foreground text-center py-4 bg-muted/20 rounded-lg">
            No alerts yet. Activity will appear here.
          </div>
        ) : (
          <>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {displayAlerts.map((alert) => (
                <div
                  key={alert.alertId}
                  className={`flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 border ${getPriorityBg(alert.priority)} ${
                    !alert.read ? "font-medium" : "opacity-75"
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {getPriorityIcon(alert.priority)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{alert.title}</div>
                    <div className="text-muted-foreground truncate">{alert.message}</div>
                    <div className="text-muted-foreground/70 text-[10px] mt-0.5">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Mark All Read */}
            {hasUnread && (
              <button
                onClick={markAllRead}
                className="w-full text-xs text-center py-1.5 text-yellow-600 hover:bg-yellow-500/10 rounded-lg transition-colors"
              >
                <CheckCircle className="h-3 w-3 inline mr-1" />
                Mark all as read
              </button>
            )}
          </>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-yellow-500 !border-2 !border-yellow-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-yellow-500 !border-2 !border-yellow-600 !w-3 !h-3"
      />
    </div>
  );
}

export default memo(AlertNode);
