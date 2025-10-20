"use client";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Strategy } from "../types";
import { getRiskColor } from "../utils";

interface RiskMetricsProps {
  strategy: Strategy;
}

export function RiskMetrics({ strategy }: RiskMetricsProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm">Risk Level</span>
          <span className={cn("text-sm font-medium", getRiskColor(strategy.risk))}>{strategy.risk}</span>
        </div>
        <Progress
          value={strategy.risk === "Low" ? 33 : strategy.risk === "Medium" ? 66 : 100}
          className={cn("h-2", strategy.risk === "Low" ? "bg-green-100 dark:bg-green-900" : strategy.risk === "Medium" ? "bg-yellow-100 dark:bg-yellow-900" : "bg-red-100 dark:bg-red-900")}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm">Win Rate</span>
          <span className="text-sm font-medium">{strategy.winRate.toFixed(1)}%</span>
        </div>
        <Progress value={strategy.winRate} className="h-2" />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm">Profit Factor</span>
          <span className="text-sm font-medium">{strategy.profitFactor.toFixed(1)}</span>
        </div>
        <Progress value={(strategy.profitFactor / 3) * 100} max={100} className="h-2" />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm">Max Drawdown</span>
          <span className="text-sm font-medium">{strategy.maxDrawdown.toFixed(1)}%</span>
        </div>
        <Progress value={strategy.maxDrawdown} max={50} className="h-2 bg-red-100 dark:bg-red-900" />
      </div>
    </div>
  );
}
