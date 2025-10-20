"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { History, Settings } from "lucide-react";
import type { BotData } from "../types";
import { formatCurrency, formatDate } from "../utils";
import { AiInsights } from "./ai-insights";
import { PerformanceChart } from "./performance-chart";

interface OverviewSectionProps {
  botData: BotData;
  onViewAllTrades: () => void;
  onViewAllInsights: () => void;
}

export function OverviewSection({ botData, onViewAllTrades, onViewAllInsights }: OverviewSectionProps) {
  return (
    <>
      <PerformanceChart />

      <AiInsights insights={botData.aiInsights} onViewAll={onViewAllInsights} />

      {/* Quick stats */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Active strategy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Strategy</CardTitle>
          </CardHeader>
          <CardContent>
            {botData.strategies
              .filter((s) => s.active)
              .map((strategy) => (
                <div key={strategy.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{strategy.name}</h3>
                    <Badge variant="outline">{strategy.timeframe}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{strategy.description}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span>Risk level:</span>
                    <Badge variant={strategy.risk === "low" ? "secondary" : strategy.risk === "medium" ? "default" : "destructive"}>{strategy.risk}</Badge>
                  </div>
                  <div className="pt-2">
                    <Button variant="outline" size="sm" className="gap-1">
                      <Settings className="h-4 w-4" />
                      <span>Configure</span>
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>

        {/* Recent trades */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {botData.recentTrades.slice(0, 3).map((trade) => (
                <div key={trade.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="font-medium">{trade.pair}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(trade.time)}</div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-medium", trade.type === "buy" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                      {trade.type.toUpperCase()} {trade.amount}
                    </div>
                    <div className="text-xs text-muted-foreground">@ {formatCurrency(trade.price)}</div>
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="w-full gap-1" href="/trading">
                <History className="h-4 w-4" />
                <span>View All Trades</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
