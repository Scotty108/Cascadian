/**
 * EXIT SIGNAL NODE
 *
 * Configure exit rules for copy trade positions.
 * Supports price targets, stop losses, and following wallet exits.
 */

"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import {
  LogOut,
  Target,
  ShieldAlert,
  TrendingDown,
  Users,
  Settings,
} from "lucide-react"

// ============================================================================
// Types
// ============================================================================

export interface ExitSignalConfig {
  // Price target (take profit)
  priceTargetEnabled?: boolean;
  priceTargetPercent?: number; // e.g., 50 = exit when 50% profit

  // Stop loss
  stopLossEnabled?: boolean;
  stopLossPercent?: number; // e.g., 20 = exit when 20% loss

  // Follow wallet exits
  followWalletExitsEnabled?: boolean;
  exitWhenWalletsExit?: number; // e.g., 2 = exit when 2 source wallets exit

  // Time-based
  maxHoldDays?: number; // Optional: exit after N days
}

interface ExitSignalNodeProps {
  data: {
    config?: ExitSignalConfig;
    status?: "idle" | "active" | "triggered";
    triggeredCount?: number;
  };
  selected?: boolean;
  id: string;
}

// ============================================================================
// Component
// ============================================================================

function ExitSignalNode({ data, selected }: ExitSignalNodeProps) {
  const config = data.config || {};
  const triggeredCount = data.triggeredCount || 0;

  const hasAnyRule =
    config.priceTargetEnabled ||
    config.stopLossEnabled ||
    config.followWalletExitsEnabled;

  const borderColor = {
    idle: "border-border",
    active: "border-orange-500 bg-orange-500/5",
    triggered: "border-green-500 bg-green-500/5",
  }[data.status || "idle"];

  // Not configured state
  if (!hasAnyRule) {
    return (
      <div
        data-testid="exit-signal-node"
        className={`rounded-2xl border-2 ${
          selected ? "ring-2 ring-[#00E0AA] ring-offset-2 border-[#00E0AA]" : "border-border"
        } bg-gradient-to-br from-orange-500/10 to-amber-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[260px] antialiased`}
        style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
      >
        <div className="px-4 py-3 border-b border-orange-500/20 bg-orange-500/5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-orange-500/20 p-1.5">
              <LogOut className="h-4 w-4 text-orange-500" />
            </div>
            <div className="font-semibold text-sm">Exit Signal</div>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Click to configure exit rules (take profit, stop loss, etc.)
          </div>
        </div>
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-orange-500 !border-2 !border-orange-600 !w-3 !h-3"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-orange-500 !border-2 !border-orange-600 !w-3 !h-3"
        />
      </div>
    );
  }

  return (
    <div
      data-testid="exit-signal-node"
      className={`rounded-2xl border-2 ${borderColor} ${
        selected ? "ring-2 ring-[#00E0AA] ring-offset-2" : ""
      } bg-gradient-to-br from-orange-500/10 to-amber-600/5 shadow-lg backdrop-blur-sm transition-all hover:shadow-xl min-w-[280px] max-w-[320px] antialiased`}
      style={{ backfaceVisibility: "hidden", transform: "translateZ(0)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-orange-500/20 bg-orange-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-orange-500/20 p-1.5">
              <LogOut className="h-4 w-4 text-orange-500" />
            </div>
            <div className="font-semibold text-sm">Exit Signal</div>
          </div>
          {triggeredCount > 0 && (
            <div className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/20 text-green-700 dark:text-green-300">
              {triggeredCount} triggered
            </div>
          )}
        </div>
      </div>

      {/* Exit Rules */}
      <div className="px-4 py-3 space-y-2">
        {/* Price Target */}
        {config.priceTargetEnabled && (
          <div className="flex items-center gap-2 text-xs bg-green-500/10 rounded-lg px-2 py-1.5">
            <Target className="h-3.5 w-3.5 text-green-500" />
            <span className="font-medium">Take Profit</span>
            <span className="text-muted-foreground ml-auto">
              @ +{config.priceTargetPercent || 50}%
            </span>
          </div>
        )}

        {/* Stop Loss */}
        {config.stopLossEnabled && (
          <div className="flex items-center gap-2 text-xs bg-red-500/10 rounded-lg px-2 py-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
            <span className="font-medium">Stop Loss</span>
            <span className="text-muted-foreground ml-auto">
              @ -{config.stopLossPercent || 20}%
            </span>
          </div>
        )}

        {/* Follow Wallet Exits */}
        {config.followWalletExitsEnabled && (
          <div className="flex items-center gap-2 text-xs bg-blue-500/10 rounded-lg px-2 py-1.5">
            <Users className="h-3.5 w-3.5 text-blue-500" />
            <span className="font-medium">Follow Exits</span>
            <span className="text-muted-foreground ml-auto">
              {config.exitWhenWalletsExit || 1} wallet{(config.exitWhenWalletsExit || 1) > 1 ? "s" : ""} exit
            </span>
          </div>
        )}

        {/* Max Hold */}
        {config.maxHoldDays && (
          <div className="flex items-center gap-2 text-xs bg-gray-500/10 rounded-lg px-2 py-1.5">
            <Settings className="h-3.5 w-3.5 text-gray-500" />
            <span className="font-medium">Max Hold</span>
            <span className="text-muted-foreground ml-auto">
              {config.maxHoldDays} days
            </span>
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-muted-foreground pt-1 border-t border-orange-500/10">
          Exits apply to all positions from upstream copy trades
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-orange-500 !border-2 !border-orange-600 !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-orange-500 !border-2 !border-orange-600 !w-3 !h-3"
      />
    </div>
  );
}

export default memo(ExitSignalNode);
