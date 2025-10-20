"use client";

import { useState } from "react";
import type { ChartType, TimeframeType } from "../types";

export function useDashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [profitTimeframe, setProfitTimeframe] = useState<TimeframeType>("monthly");
  const [profitChartType, setProfitChartType] = useState<ChartType>("bar");

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate refresh delay
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  };

  const handleTimeframeChange = (timeframe: TimeframeType) => {
    setProfitTimeframe(timeframe);
  };

  const handleChartTypeChange = (chartType: ChartType) => {
    setProfitChartType(chartType);
  };

  return {
    isRefreshing,
    profitTimeframe,
    profitChartType,
    handleRefresh,
    handleTimeframeChange,
    handleChartTypeChange,
  };
}
