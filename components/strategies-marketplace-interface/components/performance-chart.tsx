"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LineChart } from "lucide-react"
import { useTheme } from "next-themes"
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import type { Strategy, TimeFrame } from "../types"

interface PerformanceChartProps {
  strategy: Strategy
  height?: number
  showControls?: boolean
}

export function PerformanceChart({ strategy, height = 120, showControls = false }: PerformanceChartProps) {
  const [selectedTimeFrame, setSelectedTimeFrame] = useState<TimeFrame>("1M")
  const { theme } = useTheme()

  const timeFrames: TimeFrame[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "All"]

  return (
    <div>
      {showControls && (
        <div className="mb-2 flex items-center gap-2 flex-wrap justify-between">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-muted-foreground" />
            <span>Performance Chart</span>
          </div>
          <div className="flex items-center flex-wrap gap-1">
            {timeFrames.map((tf) => (
              <Button
                key={tf}
                variant={selectedTimeFrame === tf ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedTimeFrame(tf)}
              >
                {tf}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart
            data={strategy.chartData[selectedTimeFrame]}
            margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
          >
            {showControls && (
              <>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" />
                <YAxis />
                <RechartsTooltip />
              </>
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={theme === "dark" ? "#3b82f6" : "#2563eb"}
              strokeWidth={2}
              dot={false}
              activeDot={showControls ? { r: 6 } : undefined}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
