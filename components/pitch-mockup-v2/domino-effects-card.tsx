"use client";

import { Network, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";

/**
 * Domino Effects Card - Enterprise Style
 * Professional, muted design showing cascading effects
 */
export function DominoEffectsCard() {
  const effects = [
    {
      category: "Lending & Housing",
      chain: "Rate cut → Lower mortgage rates → Housing liquidity ↑",
      impact: "+15-20% txn vol",
    },
    {
      category: "Financial Markets",
      chain: "Lower rates → Risk-on sentiment → Equities rally",
      impact: "+12% crypto",
    },
    {
      category: "Currency & Commodities",
      chain: "Fed easing → USD weakens → EM debt relief",
      impact: "Commodities ↑",
    },
    {
      category: "Corporate Strategy",
      chain: "Lower borrowing → Delayed CAPEX unlocked",
      impact: "M&A ↑ Q1 2026",
    },
  ];

  return (
    <div className="h-full bg-card border border-border rounded-xl p-5 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Knock-On Effects</span>
        </div>
        <span className="text-[10px] px-2 py-1 bg-muted text-muted-foreground rounded border border-border">
          IF YES RESOLVES
        </span>
      </div>

      {/* Effects Table */}
      <div className="space-y-3 flex-1">
        {effects.map((effect, index) => (
          <div
            key={index}
            className="border-l-2 border-border pl-3 py-1 transition-all duration-200 hover:border-l-cyan-400 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground">
                {effect.category}
              </span>
              <span className="text-[11px] font-mono text-emerald-500">
                {effect.impact}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
              {effect.chain.split(' → ').map((part, i, arr) => (
                <span key={i} className="flex items-center gap-1">
                  <span>{part}</span>
                  {i < arr.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
                  )}
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>

      {/* Sector Impact Summary */}
      <div className="mt-4 pt-3 border-t border-border">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
          Sector Impact (30-day)
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center justify-between p-1.5 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
            <span className="text-muted-foreground">REITs</span>
            <span className="font-mono tabular-nums text-emerald-500 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />+8.2%
            </span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
            <span className="text-muted-foreground">Utilities</span>
            <span className="font-mono tabular-nums text-emerald-500 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />+6.1%
            </span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
            <span className="text-muted-foreground">Growth Tech</span>
            <span className="font-mono tabular-nums text-emerald-500 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />+11.4%
            </span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
            <span className="text-muted-foreground">USD Index</span>
            <span className="font-mono tabular-nums text-red-400 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" />-2.3%
            </span>
          </div>
        </div>
      </div>

      {/* Historical Context */}
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Historical:</span> Last 5 rate cuts → risk assets +8.4% avg in 30 days.
        </p>
      </div>
    </div>
  );
}
