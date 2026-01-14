"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTierConfig } from "@/hooks/use-wallet-wio";

interface StatsRowProps {
  credibility: number;
  tier?: string | null;
  winRate: number;
  resolvedPositions: number;
}

export function StatsRow({
  credibility,
  tier,
  winRate,
  resolvedPositions,
}: StatsRowProps) {
  const tierConfig = getTierConfig(tier as any);

  return (
    <Card className="p-0 bg-card border-border/50 overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-border/50">
        {/* Credibility */}
        <div className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Credibility</p>
          <p className="text-2xl font-bold">{(credibility * 100).toFixed(0)}%</p>
          {tier && (
            <Badge
              variant="outline"
              className={`${tierConfig.bgColor} ${tierConfig.textColor} border-0 text-xs mt-1`}
            >
              {tierConfig.label}
            </Badge>
          )}
        </div>

        {/* Win Rate */}
        <div className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
          <p className="text-2xl font-bold">
            {(winRate * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">{resolvedPositions} resolved</p>
        </div>
      </div>
    </Card>
  );
}
