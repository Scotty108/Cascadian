"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, formatDate } from "../utils"
import type { PerformanceData } from "../types"
import { TrendingUp, TrendingDown } from "lucide-react"

interface PerformanceChartProps {
  data: PerformanceData[]
  initialBalance: number
  currentBalance: number
}

export function PerformanceChart({ data, initialBalance, currentBalance }: PerformanceChartProps) {
  const totalProfit = currentBalance - initialBalance
  const totalProfitPercent = ((totalProfit / initialBalance) * 100).toFixed(2)
  const isProfitable = totalProfit >= 0

  // Calculate chart dimensions - use larger width for better scaling
  const chartHeight = 300
  const chartWidth = 1200
  const padding = { top: 20, right: 20, bottom: 40, left: 60 }
  const innerWidth = chartWidth - padding.left - padding.right
  const innerHeight = chartHeight - padding.top - padding.bottom

  // Get min and max values for scaling
  const values = data.map(d => d.balance)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const valueRange = maxValue - minValue

  // Scale functions
  const xScale = (index: number) => {
    return padding.left + (index / (data.length - 1)) * innerWidth
  }

  const yScale = (value: number) => {
    return chartHeight - padding.bottom - ((value - minValue) / valueRange) * innerHeight
  }

  // Generate path for line
  const linePath = data.map((point, i) => {
    const x = xScale(i)
    const y = yScale(point.balance)
    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
  }).join(' ')

  // Generate area path (for fill under the line)
  const areaPath = `${linePath} L ${xScale(data.length - 1)} ${chartHeight - padding.bottom} L ${xScale(0)} ${chartHeight - padding.bottom} Z`

  // Y-axis ticks
  const yTicks = 5
  const yTickValues = Array.from({ length: yTicks }, (_, i) => {
    return minValue + (valueRange / (yTicks - 1)) * i
  })

  // X-axis ticks (show every 7th day or so)
  const xTickInterval = Math.max(1, Math.floor(data.length / 7))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Performance Overview</span>
          <div className={`flex items-center gap-2 text-lg ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
            {isProfitable ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            <span className="font-bold">{formatCurrency(totalProfit)}</span>
            <span className="text-sm">({totalProfitPercent}%)</span>
          </div>
        </CardTitle>
        <CardDescription>Balance and profit over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-full">
          <svg
            width="100%"
            height="auto"
            className="w-full"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ maxHeight: '300px' }}
          >
            {/* Grid lines */}
            {yTickValues.map((value, i) => (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={yScale(value)}
                  x2={chartWidth - padding.right}
                  y2={yScale(value)}
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 10}
                  y={yScale(value)}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  className="text-xs fill-muted-foreground"
                >
                  {formatCurrency(value)}
                </text>
              </g>
            ))}

            {/* Area fill */}
            <path
              d={areaPath}
              fill={isProfitable ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)"}
            />

            {/* Line */}
            <path
              d={linePath}
              fill="none"
              stroke={isProfitable ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"}
              strokeWidth="2"
            />

            {/* Data points */}
            {data.map((point, i) => (
              <g key={i}>
                <circle
                  cx={xScale(i)}
                  cy={yScale(point.balance)}
                  r="4"
                  fill={isProfitable ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"}
                  className="hover:r-6 transition-all cursor-pointer"
                />
                <title>
                  {formatDate(point.date)}: {formatCurrency(point.balance)}
                </title>
              </g>
            ))}

            {/* X-axis labels */}
            {data.map((point, i) => {
              if (i % xTickInterval === 0 || i === data.length - 1) {
                return (
                  <text
                    key={i}
                    x={xScale(i)}
                    y={chartHeight - padding.bottom + 20}
                    textAnchor="middle"
                    className="text-xs fill-muted-foreground"
                  >
                    {formatDate(point.date)}
                  </text>
                )
              }
              return null
            })}

            {/* Axes */}
            <line
              x1={padding.left}
              y1={chartHeight - padding.bottom}
              x2={chartWidth - padding.right}
              y2={chartHeight - padding.bottom}
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="1"
            />
            <line
              x1={padding.left}
              y1={padding.top}
              x2={padding.left}
              y2={chartHeight - padding.bottom}
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="1"
            />
          </svg>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t">
          <div className="text-center">
            <div className="text-2xl font-bold">{formatCurrency(currentBalance)}</div>
            <div className="text-sm text-muted-foreground">Current Balance</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{formatCurrency(initialBalance)}</div>
            <div className="text-sm text-muted-foreground">Initial Balance</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totalProfit)}
            </div>
            <div className="text-sm text-muted-foreground">Total Profit</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-bold ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
              {totalProfitPercent}%
            </div>
            <div className="text-sm text-muted-foreground">ROI</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
