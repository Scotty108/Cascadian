"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lightbulb, ArrowRight, TrendingUp, AlertTriangle, Zap } from "lucide-react";

// Hardcoded insights
const insights = [
  {
    type: "opportunity",
    icon: TrendingUp,
    title: "Arbitrage Opportunity",
    description: "7% spread between Polymarket and PredictIt. Consider cross-platform hedging.",
    priority: "HIGH",
  },
  {
    type: "alert",
    icon: AlertTriangle,
    title: "Fed Minutes Released",
    description: "December FOMC minutes show 9-3 vote likely. Market hasn't fully priced this in.",
    priority: "MEDIUM",
  },
  {
    type: "action",
    icon: Zap,
    title: "Smart Money Signal",
    description: "Top wallet 0x7a3...f2c9 just added $450K to YES position. Historical accuracy: 89%.",
    priority: "HIGH",
  },
];

const recommendations = [
  { action: "BUY YES", rationale: "Underpriced by 7% vs Cascadian model", confidence: 94 },
  { action: "SET ALERT", rationale: "Monitor for Fed speaker comments", confidence: 78 },
];

export function InsightsPanel() {
  return (
    <Card className="p-4 border-border/50 bg-gradient-to-br from-amber-500/5 to-background">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1">
          <Lightbulb className="h-4 w-4 text-amber-400" />
          AI Insights
        </h3>
        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
          3 New
        </Badge>
      </div>

      {/* Insights list */}
      <div className="space-y-3 mb-4">
        {insights.map((insight, index) => {
          const Icon = insight.icon;
          return (
            <div
              key={index}
              className="bg-muted/30 rounded-lg p-3 border-l-2 border-amber-500/50"
            >
              <div className="flex items-start gap-2">
                <Icon className={`h-4 w-4 mt-0.5 ${
                  insight.type === "opportunity" ? "text-emerald-400" :
                  insight.type === "alert" ? "text-amber-400" : "text-violet-400"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{insight.title}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-5 ${
                        insight.priority === "HIGH"
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {insight.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      <div className="border-t border-border/50 pt-3">
        <div className="text-xs text-muted-foreground font-medium mb-2">Recommended Actions</div>
        <div className="space-y-2">
          {recommendations.map((rec, index) => (
            <Button
              key={index}
              variant="outline"
              size="sm"
              className="w-full justify-between h-auto py-2 px-3"
            >
              <div className="text-left">
                <div className="text-sm font-semibold text-emerald-400">{rec.action}</div>
                <div className="text-xs text-muted-foreground">{rec.rationale}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{rec.confidence}%</span>
                <ArrowRight className="h-4 w-4" />
              </div>
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
