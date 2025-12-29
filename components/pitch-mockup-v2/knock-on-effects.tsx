"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Building2, Home, Landmark, TrendingUp, Coins, CreditCard } from "lucide-react";

// Hardcoded domino/knock-on effects if Fed cuts rates
const effects = [
  {
    icon: CreditCard,
    category: "Lending",
    title: "Interest Rates Drop",
    impact: "+",
    description: "Consumer & business borrowing costs decrease 0.25-0.50%",
    confidence: 95,
  },
  {
    icon: Building2,
    category: "Banking",
    title: "Bank Revenue Mix Shift",
    impact: "+",
    description: "Increased loan origination volume, margin compression",
    confidence: 88,
  },
  {
    icon: Home,
    category: "Real Estate",
    title: "Housing Liquidity Surge",
    impact: "+",
    description: "Mortgage rates decline, stimulating buyer demand",
    confidence: 92,
  },
  {
    icon: Coins,
    category: "Crypto",
    title: "Risk Assets Rally",
    impact: "+",
    description: "Looser monetary policy historically bullish for BTC",
    confidence: 78,
  },
  {
    icon: Landmark,
    category: "Global",
    title: "USD Weakens",
    impact: "-",
    description: "Dollar index likely to decline, EM currencies strengthen",
    confidence: 85,
  },
  {
    icon: TrendingUp,
    category: "Equities",
    title: "Growth Stocks Outperform",
    impact: "+",
    description: "Lower discount rates favor high-duration assets",
    confidence: 90,
  },
];

export function KnockOnEffects() {
  return (
    <Card className="p-4 border-border/50 bg-gradient-to-br from-indigo-500/5 to-background">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <GitBranch className="h-4 w-4 text-indigo-400" />
          Knock-On Effects
        </h3>
        <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
          If YES
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Cascading market impacts if the Fed cuts rates in December 2025:
      </p>

      {/* Effects grid */}
      <div className="space-y-2">
        {effects.map((effect, index) => {
          const Icon = effect.icon;
          return (
            <div
              key={index}
              className="flex items-start gap-3 p-2 bg-muted/20 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className={`p-1.5 rounded-md ${
                effect.impact === "+"
                  ? "bg-emerald-500/10"
                  : "bg-rose-500/10"
              }`}>
                <Icon className={`h-4 w-4 ${
                  effect.impact === "+"
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{effect.title}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      {effect.category}
                    </Badge>
                  </div>
                  <span className={`text-xs font-bold ${
                    effect.impact === "+"
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}>
                    {effect.impact === "+" ? "Bullish" : "Bearish"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{effect.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Disclaimer */}
      <div className="mt-3 pt-2 border-t border-border/50">
        <p className="text-[10px] text-muted-foreground text-center">
          AI-generated analysis. Past performance is not indicative of future results.
        </p>
      </div>
    </Card>
  );
}
