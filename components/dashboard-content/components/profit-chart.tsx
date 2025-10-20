"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProfitData, TimeframeType } from "../types";

interface ProfitChartProps {
  profitData: ProfitData;
  timeframe: TimeframeType;
  onTimeframeChange: (timeframe: TimeframeType) => void;
}

export function ProfitChart({ profitData, timeframe, onTimeframeChange }: ProfitChartProps) {
  // Get the appropriate profit data based on the selected timeframe
  const getProfitData = () => {
    switch (timeframe) {
      case "daily":
        return profitData.daily;
      case "weekly":
        return profitData.weekly;
      case "monthly":
      default:
        return profitData.monthly;
    }
  };

  return (
    <Card className="lg:col-span-4">
      <CardHeader className="px-2">
        <CardTitle>Profit Chart</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <div className="mb-4 flex items-center gap-2">
          <Button variant={timeframe === "daily" ? "default" : "outline"} size="sm" onClick={() => onTimeframeChange("daily")}>
            Daily
          </Button>
          <Button variant={timeframe === "weekly" ? "default" : "outline"} size="sm" onClick={() => onTimeframeChange("weekly")}>
            Weekly
          </Button>
          <Button variant={timeframe === "monthly" ? "default" : "outline"} size="sm" onClick={() => onTimeframeChange("monthly")}>
            Monthly
          </Button>
        </div>
        <div className="h-[240px] w-full">
          <div className="flex  h-full w-full gap-2">
            {getProfitData().map((item, index) => (
              <div key={index} className="flex flex-col items-center justify-end space-y-1 flex-1">
                <div className="text-[8px] min-[450px]:text-xs font-medium text-green-500">${item.total.toLocaleString()}</div>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-green-500 to-green-400"
                  style={{
                    height: `${(item.total / Math.max(...getProfitData().map((d) => d.total))) * 180}px`,
                    minHeight: "20px",
                  }}
                />
                <div className="text-xs text-muted-foreground">{item.date}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
