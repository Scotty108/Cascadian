"use client";

import { Wallet, TrendingUp, Users, BarChart3 } from "lucide-react";

/**
 * Smart Money Card - Enterprise Style
 * Professional design with clean borders
 */
export function SmartMoneyCard() {
  return (
    <div className="h-full bg-card border border-border rounded-xl p-5 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Smart Money Signal</span>
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Bullish
        </span>
      </div>

      {/* Sentiment Bar */}
      <div className="mb-4">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out" style={{ width: "82%" }} />
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className="font-mono tabular-nums text-blue-500">82% YES</span>
          <span className="text-muted-foreground font-mono tabular-nums">18% NO</span>
        </div>
      </div>

      {/* Narrative Analysis */}
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">What smart money is doing:</span> Our top 50
          tracked wallets have accumulated $4.2M in YES positions over the past 7 days. This represents
          a 340% increase in positioning compared to the 30-day average.
        </p>

        <p className="text-muted-foreground leading-relaxed text-xs">
          Notably, wallets with &gt;90% historical accuracy are showing 89% agreement on this
          outcome. The average position size has increased to $125K, suggesting high conviction.
        </p>
      </div>

      {/* Key Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border flex-1">
        <div className="border border-border rounded-lg p-2.5 transition-all duration-200 hover:border-cyan-400/50 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">Top Wallets</span>
          </div>
          <div className="text-sm font-mono font-semibold tabular-nums">38 YES / 12 NO</div>
        </div>

        <div className="border border-border rounded-lg p-2.5 transition-all duration-200 hover:border-cyan-400/50 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">24h Flow</span>
          </div>
          <div className="text-sm font-mono font-semibold tabular-nums text-emerald-500">+$2.3M YES</div>
        </div>

        <div className="border border-border rounded-lg p-2.5 transition-all duration-200 hover:border-cyan-400/50 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">Avg Position</span>
          </div>
          <div className="text-sm font-mono font-semibold tabular-nums">$125K</div>
        </div>

        <div className="border border-border rounded-lg p-2.5 transition-all duration-200 hover:border-cyan-400/50 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
          <div className="flex items-center gap-1.5 mb-1">
            <BarChart3 className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase">90d Accuracy</span>
          </div>
          <div className="text-sm font-mono font-semibold tabular-nums">89%</div>
        </div>
      </div>

      {/* Insider Correlation */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Insider correlation score</span>
          <span className="font-mono font-semibold">0.87</span>
        </div>
      </div>
    </div>
  );
}
