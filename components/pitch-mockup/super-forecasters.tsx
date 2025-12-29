"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flag, Trophy, CheckCircle2 } from "lucide-react";

// Hardcoded super forecaster data
const forecasterData = {
  totalForecasters: 47,
  yesVotes: 38,
  noVotes: 9,
  topForecasters: [
    { name: "PhilipTetlock", accuracy: 94, vote: "YES", confidence: "HIGH" },
    { name: "NateSilver", accuracy: 91, vote: "YES", confidence: "HIGH" },
    { name: "ScottAlexander", accuracy: 89, vote: "YES", confidence: "MEDIUM" },
    { name: "EliezerYudkowsky", accuracy: 87, vote: "NO", confidence: "LOW" },
    { name: "CaplanEcon", accuracy: 86, vote: "YES", confidence: "HIGH" },
  ],
};

export function SuperForecasters() {
  const yesPercent = Math.round((forecasterData.yesVotes / forecasterData.totalForecasters) * 100);

  return (
    <Card className="p-4 border-border/50 bg-gradient-to-br from-cyan-500/5 to-background">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Trophy className="h-4 w-4 text-cyan-400" />
          Super Forecasters
        </h3>
        <Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
          {forecasterData.totalForecasters} Active
        </Badge>
      </div>

      {/* Vote breakdown */}
      <div className="bg-muted/30 rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-emerald-500" />
            <span className="text-2xl font-bold text-emerald-500">{forecasterData.yesVotes}</span>
            <span className="text-sm text-muted-foreground">for YES</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-rose-500">{forecasterData.noVotes}</span>
            <span className="text-sm text-muted-foreground">for NO</span>
            <Flag className="h-4 w-4 text-rose-500" />
          </div>
        </div>

        {/* Visual bar */}
        <div className="h-2 bg-rose-500/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${yesPercent}%` }}
          />
        </div>
        <div className="text-center text-xs text-muted-foreground mt-1">
          {yesPercent}% consensus for YES
        </div>
      </div>

      {/* Top forecasters */}
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-medium">Top Rated Forecasters</div>
        {forecasterData.topForecasters.map((forecaster, index) => (
          <div
            key={forecaster.name}
            className="flex items-center justify-between text-sm py-1 border-b border-border/30 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-4">{index + 1}.</span>
              <span className="font-medium">{forecaster.name}</span>
              {forecaster.accuracy >= 90 && (
                <CheckCircle2 className="h-3 w-3 text-amber-400" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{forecaster.accuracy}%</span>
              <Badge
                variant="outline"
                className={`text-[10px] h-5 ${
                  forecaster.vote === "YES"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                }`}
              >
                {forecaster.vote}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
