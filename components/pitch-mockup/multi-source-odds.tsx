"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

// Hardcoded odds from multiple platforms
const platformOdds = [
  {
    name: "Polymarket",
    logo: "/polymarket-logo.svg", // We'll use text fallback
    yes: 87,
    change: 2.3,
    volume: "$24.5M",
  },
  {
    name: "Kalshi",
    logo: "/kalshi-logo.svg",
    yes: 84,
    change: 1.8,
    volume: "$8.2M",
  },
  {
    name: "Robinhood",
    logo: "/robinhood-logo.svg",
    yes: 85,
    change: -0.5,
    volume: "$3.1M",
  },
  {
    name: "PredictIt",
    logo: "/predictit-logo.svg",
    yes: 82,
    change: 0,
    volume: "$1.4M",
  },
];

export function MultiSourceOdds() {
  // Calculate average
  const avgYes = Math.round(platformOdds.reduce((acc, p) => acc + p.yes, 0) / platformOdds.length);

  return (
    <Card className="p-4 border-border/50 bg-gradient-to-br from-blue-500/5 to-background">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Cross-Platform Odds</h3>
        <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
          Live
        </Badge>
      </div>

      {/* Consensus */}
      <div className="bg-muted/30 rounded-lg p-3 mb-3">
        <div className="text-xs text-muted-foreground mb-1">Market Consensus</div>
        <div className="text-2xl font-bold text-blue-400">{avgYes}% YES</div>
      </div>

      {/* Platform breakdown */}
      <div className="space-y-2">
        {platformOdds.map((platform) => (
          <div key={platform.name} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                {platform.name[0]}
              </div>
              <span className="text-muted-foreground">{platform.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{platform.yes}%</span>
              {platform.change > 0 && (
                <span className="flex items-center text-emerald-500 text-xs">
                  <ArrowUp className="h-3 w-3" />
                  {platform.change}
                </span>
              )}
              {platform.change < 0 && (
                <span className="flex items-center text-rose-500 text-xs">
                  <ArrowDown className="h-3 w-3" />
                  {Math.abs(platform.change)}
                </span>
              )}
              {platform.change === 0 && (
                <span className="flex items-center text-muted-foreground text-xs">
                  <Minus className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Total volume */}
      <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground text-center">
        Combined Volume: <span className="font-semibold text-foreground">$37.2M</span>
      </div>
    </Card>
  );
}
