"use client"

import { useMemo } from "react"

import ReactECharts from "echarts-for-react"
import { useTheme } from "next-themes"
import { TrendingDown, TrendingUp } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { ACCENT_COLOR, formatCurrency, formatDate, formatNumber } from "../utils"
import type { PerformanceData } from "../types"

interface PerformanceChartProps {
  data: PerformanceData[]
  initialBalance: number
  currentBalance: number
}

export function PerformanceChart({ data, initialBalance, currentBalance }: PerformanceChartProps) {
  const { theme } = useTheme()

  const isDark = theme === "dark"
  const totalProfit = currentBalance - initialBalance
  const totalProfitPercent = (totalProfit / initialBalance) * 100
  const isProfitable = totalProfit >= 0

  const axisColor = isDark ? "rgba(148, 163, 184, 0.48)" : "rgba(100, 116, 139, 0.38)"
  const gridColor = isDark ? "rgba(30, 41, 59, 0.8)" : "rgba(226, 232, 240, 0.9)"
  const labelColor = isDark ? "rgba(226,232,240,0.85)" : "rgba(15,23,42,0.78)"
  const tooltipBg = isDark ? "rgba(8,15,32,0.94)" : "rgba(255,255,255,0.94)"

  const chartSeriesData = useMemo(
    () =>
      data.map(item => ({
        value: Number(item.balance.toFixed(2)),
        rawProfit: item.profit,
        trades: item.trades,
        winRate: item.winRate,
        label: formatDate(item.date),
      })),
    [data]
  )

  const chartOptions = useMemo(
    () => ({
      animationDuration: 700,
      animationEasing: 'cubicOut',
      backgroundColor: "transparent",
      grid: { left: "2%", right: "3%", top: 80, bottom: 50, containLabel: true },
      tooltip: {
        trigger: "axis",
        className: "echarts-tooltip",
        backgroundColor: tooltipBg,
        borderColor: `${ACCENT_COLOR}80`,
        borderWidth: 1,
        textStyle: { color: labelColor, fontSize: 12 },
        padding: 12,
        axisPointer: { lineStyle: { color: ACCENT_COLOR, width: 1.5 } },
        formatter: (params: any[]) => {
          const point = params[0]
          const dataPoint = point?.data
          if (!dataPoint) return ""

          const rows = [
            `<div style="font-weight:600; margin-bottom:6px;">${dataPoint.label}</div>`,
            `<div>Balance: <strong>${formatCurrency(dataPoint.value)}</strong></div>`,
            `<div>Session PnL: <strong>${formatCurrency(dataPoint.rawProfit)}</strong></div>`,
            `<div>Trades: <strong>${dataPoint.trades}</strong> • Win rate: <strong>${formatNumber(dataPoint.winRate, 1)}%</strong></div>`,
          ]

          return rows.join("")
        },
      },
      xAxis: {
        type: "category",
        data: chartSeriesData.map(point => point.label),
        boundaryGap: false,
        axisLabel: { color: labelColor, fontSize: 12 },
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: labelColor,
          formatter: (value: number) => formatCurrency(value),
        },
        axisLine: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor, opacity: isDark ? 0.25 : 0.45, type: "dashed" },
        },
        axisPointer: { label: { show: false } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          data: chartSeriesData,
          lineStyle: { width: 3, color: ACCENT_COLOR },
          itemStyle: {
            color: ACCENT_COLOR,
            borderWidth: 1,
            borderColor: isDark ? "#0f172a" : "#f8fafc",
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${ACCENT_COLOR}55` },
                { offset: 1, color: `${ACCENT_COLOR}00` },
              ],
            },
          },
          emphasis: { focus: "series" },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          start: 0,
          end: 100,
        },
      ],
    }),
    [axisColor, chartSeriesData, gridColor, isDark, labelColor, tooltipBg]
  )

  const summaryStats = [
    { label: "Current balance", value: formatCurrency(currentBalance), accent: false },
    { label: "Initial balance", value: formatCurrency(initialBalance), accent: false },
    { label: "Net profit", value: formatCurrency(totalProfit), accent: isProfitable },
    { label: "ROI", value: `${totalProfitPercent.toFixed(2)}%`, accent: isProfitable },
  ] as const

  return (
    <Card className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-background to-background/60 shadow-sm">
      <CardHeader className="flex flex-col gap-3 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-xl font-semibold tracking-tight">Performance Overview</CardTitle>
          <CardDescription className="mt-1">Balance growth and execution velocity</CardDescription>
        </div>
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-sm"
          style={{
            backgroundColor: isProfitable ? `${ACCENT_COLOR}1A` : "rgba(239,68,68,0.1)",
            color: isProfitable ? ACCENT_COLOR : "#ef4444",
            boxShadow: isProfitable ? `inset 0 0 0 1px ${ACCENT_COLOR}33` : "none",
          }}
        >
          {isProfitable ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {formatCurrency(totalProfit)} &nbsp;•&nbsp; {totalProfitPercent.toFixed(2)}%
        </span>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <ReactECharts
          option={chartOptions}
          style={{ height: 320, width: "100%" }}
          notMerge
          lazyUpdate
        />

        <div className="grid gap-6 border-t border-border/60 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          {summaryStats.map(stat => (
            <div key={stat.label} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </p>
              <p
                className={cn(
                  "text-2xl font-semibold tracking-tight",
                  stat.accent ? "text-[#00E0AA]" : "text-foreground"
                )}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
