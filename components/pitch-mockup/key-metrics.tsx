"use client";

import { Card } from "@/components/ui/card";
import { TrendingUp, Users, Brain, Target } from "lucide-react";

/**
 * Key Metrics Row - Compact display of critical metrics
 */
export function KeyMetrics() {
  const metrics = [
    {
      label: "Cascadian Score",
      value: "94%",
      sublabel: "vs Market 87%",
      icon: Target,
      highlight: true,
    },
    {
      label: "Smart Money",
      value: "82%",
      sublabel: "YES positioning",
      icon: TrendingUp,
    },
    {
      label: "Super Forecasters",
      value: "47/50",
      sublabel: "Bullish consensus",
      icon: Brain,
    },
    {
      label: "Whale Activity",
      value: "+$4.2M",
      sublabel: "Last 24h",
      icon: Users,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {metrics.map((metric, i) => (
        <Card
          key={i}
          className={`p-3 ${
            metric.highlight
              ? "border-sky-500/50 bg-sky-500/5"
              : "border"
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-xs text-muted-foreground">{metric.label}</span>
            <metric.icon className={`h-4 w-4 ${metric.highlight ? "text-sky-500" : "text-muted-foreground"}`} />
          </div>
          <div className={`text-xl font-semibold ${metric.highlight ? "text-sky-600 dark:text-sky-400" : ""}`}>
            {metric.value}
          </div>
          <div className="text-xs text-muted-foreground">{metric.sublabel}</div>
        </Card>
      ))}
    </div>
  );
}
