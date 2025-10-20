import { formatPercentage, formatMultiplier } from "../utils"

interface PerformanceMetricsProps {
  performance: {
    winRate: number
    profitFactor: number
    maxDrawdown: number
    averageProfit: number
  }
  layout?: "grid" | "inline"
}

export function PerformanceMetrics({ performance, layout = "grid" }: PerformanceMetricsProps) {
  const metrics = [
    { label: "Win Rate", value: formatPercentage(performance.winRate) },
    { label: "Profit Factor", value: formatMultiplier(performance.profitFactor) },
    { label: "Max Drawdown", value: formatPercentage(performance.maxDrawdown) },
    { label: "Avg. Profit", value: formatPercentage(performance.averageProfit) },
  ]

  if (layout === "inline") {
    return (
      <div className="flex flex-wrap gap-4">
        {metrics.map((metric, index) => (
          <div key={index} className="flex flex-col">
            <span className="text-xs text-muted-foreground">{metric.label}</span>
            <span className="font-medium">{metric.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {metrics.map((metric, index) => (
        <div key={index} className="flex flex-col">
          <span className="text-xs text-muted-foreground">{metric.label}</span>
          <span className="font-medium">{metric.value}</span>
        </div>
      ))}
    </div>
  )
}
