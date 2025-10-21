"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, Zap } from "lucide-react";
import ReactECharts from "echarts-for-react";

// Mock data for active strategies
const mockStrategies = [
  {
    id: "strat-1",
    name: "High SII Momentum",
    status: "active",
    totalPnL: 12450,
    pnlPercent: 24.5,
    winRate: 68,
    totalTrades: 145,
    activePositions: 8,
    avgTradeSize: 250,
    sharpeRatio: 2.1,
    dailyPnL: [120, 340, -80, 450, 210, 380, 290],
  },
  {
    id: "strat-2",
    name: "Whale Following",
    status: "active",
    totalPnL: 8920,
    pnlPercent: 17.8,
    winRate: 72,
    totalTrades: 98,
    activePositions: 5,
    avgTradeSize: 420,
    sharpeRatio: 1.8,
    dailyPnL: [210, 180, 420, -120, 350, 280, 180],
  },
  {
    id: "strat-3",
    name: "Contrarian Signals",
    status: "active",
    totalPnL: -1240,
    pnlPercent: -4.2,
    winRate: 45,
    totalTrades: 67,
    activePositions: 3,
    avgTradeSize: 180,
    sharpeRatio: 0.6,
    dailyPnL: [-80, -120, 50, -90, -40, 20, -80],
  },
  {
    id: "strat-4",
    name: "Category Rotation",
    status: "active",
    totalPnL: 5630,
    pnlPercent: 11.3,
    winRate: 58,
    totalTrades: 112,
    activePositions: 6,
    avgTradeSize: 310,
    sharpeRatio: 1.4,
    dailyPnL: [90, 180, 120, 240, -60, 190, 150],
  },
];

export function DashboardContent() {
  // Calculate overall metrics
  const totalPnL = mockStrategies.reduce((sum, s) => sum + s.totalPnL, 0);
  const totalInvested = 100000; // Mock value
  const totalPnLPercent = (totalPnL / totalInvested) * 100;
  const activeStrategiesCount = mockStrategies.filter(s => s.status === "active").length;
  const totalActivePositions = mockStrategies.reduce((sum, s) => sum + s.activePositions, 0);
  const avgWinRate = mockStrategies.reduce((sum, s) => sum + s.winRate, 0) / mockStrategies.length;

  // Overall PnL chart data
  const last7Days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const overallDailyPnL = last7Days.map((_, i) =>
    mockStrategies.reduce((sum, s) => sum + s.dailyPnL[i], 0)
  );

  console.log('Overall Daily PnL:', overallDailyPnL); // Debug

  const overallPnLChartOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        if (!params || !params[0]) return '';
        return `${params[0].name}<br/>PnL: <strong>$${params[0].value}</strong>`;
      },
    },
    xAxis: {
      type: "category",
      data: last7Days,
      boundaryGap: false,
      axisLabel: {
        show: true,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) => `$${value}`,
        show: true,
      },
    },
    series: [
      {
        name: "Daily PnL",
        type: "line",
        smooth: true,
        data: overallDailyPnL,
        lineStyle: { width: 3, color: totalPnL >= 0 ? "#10b981" : "#ef4444" },
        itemStyle: { color: totalPnL >= 0 ? "#10b981" : "#ef4444" },
        areaStyle: {
          color: totalPnL >= 0
            ? "rgba(16, 185, 129, 0.1)"
            : "rgba(239, 68, 68, 0.1)"
        },
        symbol: "circle",
        symbolSize: 6,
      },
    ],
    grid: {
      left: "10%",
      right: "5%",
      bottom: "10%",
      top: "5%",
      containLabel: true,
    },
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Strategy Performance Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor and analyze the performance of your active trading strategies
        </p>
      </div>

      {/* Overall Performance KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total PnL</p>
              <h3 className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString()}
              </h3>
              <p className={`text-sm ${totalPnLPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%
              </p>
            </div>
            <DollarSign className={`h-8 w-8 ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`} />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Active Strategies</p>
              <h3 className="text-2xl font-bold">{activeStrategiesCount}</h3>
              <p className="text-sm text-muted-foreground">{totalActivePositions} positions</p>
            </div>
            <Activity className="h-8 w-8 text-blue-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Avg Win Rate</p>
              <h3 className="text-2xl font-bold">{avgWinRate.toFixed(1)}%</h3>
              <p className="text-sm text-muted-foreground">Across all strategies</p>
            </div>
            <Target className="h-8 w-8 text-purple-600" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Best Performer</p>
              <h3 className="text-lg font-bold truncate">
                {mockStrategies.sort((a, b) => b.totalPnL - a.totalPnL)[0]?.name}
              </h3>
              <p className="text-sm text-green-600">
                +${mockStrategies.sort((a, b) => b.totalPnL - a.totalPnL)[0]?.totalPnL.toLocaleString()}
              </p>
            </div>
            <Zap className="h-8 w-8 text-amber-600" />
          </div>
        </Card>
      </div>

      {/* Overall PnL Chart */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Portfolio Performance (Last 7 Days)</h2>
        <div className="h-[300px]">
          <ReactECharts
            option={overallPnLChartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge={true}
            lazyUpdate={false}
          />
        </div>
      </Card>

      {/* Active Strategies */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Active Strategies</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {mockStrategies.map((strategy) => {
            console.log(`Strategy ${strategy.name} PnL:`, strategy.dailyPnL); // Debug

            const strategyChartOption = {
              tooltip: {
                trigger: "axis",
                formatter: (params: any) => {
                  if (!params || !params[0]) return '';
                  return `${params[0].name}: <strong>$${params[0].value}</strong>`;
                },
              },
              xAxis: {
                type: "category",
                data: last7Days,
                boundaryGap: false,
                show: true,
                axisLabel: {
                  show: false,
                },
                axisLine: {
                  show: false,
                },
                axisTick: {
                  show: false,
                },
              },
              yAxis: {
                type: "value",
                show: false,
                scale: true,
              },
              series: [
                {
                  type: "line",
                  smooth: true,
                  data: strategy.dailyPnL,
                  lineStyle: {
                    width: 2,
                    color: strategy.totalPnL >= 0 ? "#10b981" : "#ef4444"
                  },
                  itemStyle: {
                    color: strategy.totalPnL >= 0 ? "#10b981" : "#ef4444"
                  },
                  areaStyle: {
                    color: strategy.totalPnL >= 0
                      ? "rgba(16, 185, 129, 0.1)"
                      : "rgba(239, 68, 68, 0.1)"
                  },
                  symbol: "circle",
                  symbolSize: 4,
                  showSymbol: false,
                },
              ],
              grid: {
                left: 5,
                right: 5,
                top: 5,
                bottom: 5,
              },
            };

            return (
              <Card key={strategy.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{strategy.name}</h3>
                    <Badge className="mt-1">{strategy.status}</Badge>
                  </div>
                  <div className="text-right">
                    <div className={`text-xl font-bold ${strategy.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.totalPnL >= 0 ? '+' : ''}${strategy.totalPnL.toLocaleString()}
                    </div>
                    <div className={`text-sm ${strategy.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.pnlPercent >= 0 ? '+' : ''}{strategy.pnlPercent}%
                    </div>
                  </div>
                </div>

                {/* Mini chart */}
                <div className="h-[80px] mb-4">
                  <ReactECharts
                    option={strategyChartOption}
                    style={{ height: "100%", width: "100%" }}
                    opts={{ renderer: "canvas" }}
                    notMerge={true}
                    lazyUpdate={false}
                  />
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Win Rate</p>
                    <p className="font-semibold">{strategy.winRate}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Trades</p>
                    <p className="font-semibold">{strategy.totalTrades}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Sharpe</p>
                    <p className="font-semibold">{strategy.sharpeRatio.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Active</p>
                    <p className="font-semibold">{strategy.activePositions}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Avg Size</p>
                    <p className="font-semibold">${strategy.avgTradeSize}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    {strategy.totalPnL >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
