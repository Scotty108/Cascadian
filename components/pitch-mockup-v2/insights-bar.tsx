"use client";

import { Card } from "@/components/ui/card";
import { ArrowRight, Zap, AlertTriangle, TrendingUp } from "lucide-react";

/**
 * Insights Bar - Bottom bar with AI insights and recommendations
 */
export function InsightsBar() {
  const insights = [
    {
      type: "opportunity",
      icon: Zap,
      title: "Arbitrage Detected",
      description: "7% spread between Polymarket (87%) and PredictIt (80%)",
      action: "Cross-platform hedge",
    },
    {
      type: "signal",
      icon: TrendingUp,
      title: "Smart Money Alert",
      description: "Top wallet 0x7a3...f2c9 added $450K YES position",
      action: "Follow position",
    },
    {
      type: "news",
      icon: AlertTriangle,
      title: "FOMC Minutes Released",
      description: "9-3 dovish vote likely per latest communications",
      action: "Review analysis",
    },
  ];

  return (
    <Card className="border-t rounded-none">
      <div className="flex items-stretch">
        {/* Insights */}
        <div className="flex-1 flex divide-x">
          {insights.map((insight, i) => (
            <div
              key={i}
              className="flex-1 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-1">
                <insight.icon className="h-3.5 w-3.5 text-sky-500" />
                <span className="text-xs font-medium">{insight.title}</span>
              </div>
              <div className="text-xs text-muted-foreground line-clamp-1">
                {insight.description}
              </div>
            </div>
          ))}
        </div>

        {/* Primary CTA */}
        <div className="border-l px-4 py-3 flex items-center">
          <button className="flex items-center gap-3 bg-sky-500 hover:bg-sky-600 text-white rounded-lg px-4 py-2 transition-colors">
            <div className="text-left">
              <div className="text-sm font-medium">BUY YES @ 87%</div>
              <div className="text-xs text-sky-100">+7% edge vs AI model</div>
            </div>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Card>
  );
}
