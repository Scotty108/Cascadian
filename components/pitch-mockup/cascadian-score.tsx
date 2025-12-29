"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, AlertTriangle } from "lucide-react";

export function CascadianScore() {
  const marketScore = 87;
  const cascadianScore = 94;
  const confidence = "HIGH";
  const edge = cascadianScore - marketScore;

  return (
    <Card className="p-4 border-border/50 bg-gradient-to-br from-violet-500/5 to-background">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Sparkles className="h-4 w-4 text-violet-400" />
          Cascadian Score
        </h3>
        <Badge variant="outline" className="text-xs bg-violet-500/10 text-violet-400 border-violet-500/30">
          Proprietary AI
        </Badge>
      </div>

      {/* Score comparison */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-muted/30 rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Market</div>
          <div className="text-2xl font-bold">{marketScore}%</div>
        </div>
        <div className="bg-violet-500/10 rounded-lg p-3 text-center border border-violet-500/30">
          <div className="text-xs text-violet-400 mb-1">Cascadian</div>
          <div className="text-2xl font-bold text-violet-400">{cascadianScore}%</div>
        </div>
      </div>

      {/* Edge indicator */}
      <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium">Alpha Edge</span>
          </div>
          <span className="text-lg font-bold text-emerald-500">+{edge}%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Market is underpricing this outcome
        </p>
      </div>

      {/* Confidence */}
      <div className="mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Model Confidence</span>
          <Badge
            variant="outline"
            className={
              confidence === "HIGH"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
            }
          >
            {confidence}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
