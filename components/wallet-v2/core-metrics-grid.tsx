"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { FingerprintMetric } from "./types";
import { METRIC_COLORS_ARRAY } from "./types";

interface CoreMetricsGridProps {
  metrics: FingerprintMetric[];
}

function getMetricStatus(normalized: number): {
  label: string;
  color: string;
} {
  if (normalized >= 80) return { label: "Excellent", color: "text-emerald-500" };
  if (normalized >= 60) return { label: "Good", color: "text-blue-500" };
  if (normalized >= 40) return { label: "Average", color: "text-amber-500" };
  if (normalized >= 20) return { label: "Below Avg", color: "text-orange-500" };
  return { label: "Poor", color: "text-red-500" };
}

export function CoreMetricsGrid({ metrics }: CoreMetricsGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {metrics.map((metric, index) => {
        const status = getMetricStatus(metric.normalized);
        const color = METRIC_COLORS_ARRAY[index];

        return (
          <motion.div
            key={metric.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.3 }}
          >
            <Card className="p-4 shadow-sm rounded-xl border-0 dark:bg-[#18181b] hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {metric.name}
                  </span>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p>{metric.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                  {metric.displayValue}
                </span>
                <span className={`text-sm font-medium ${status.color}`}>
                  {status.label}
                </span>
              </div>

              <div className="space-y-1">
                <Progress
                  value={metric.normalized}
                  className="h-2"
                  style={
                    {
                      "--progress-background": color,
                    } as React.CSSProperties
                  }
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0</span>
                  <span>{metric.normalized.toFixed(0)}/100</span>
                  <span>100</span>
                </div>
              </div>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
