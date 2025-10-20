import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { PortfolioMetric } from "../../types"

interface PortfolioMetricsProps {
  metrics: PortfolioMetric[]
}

export function PortfolioMetrics({ metrics }: PortfolioMetricsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Metrics</CardTitle>
        <CardDescription>Key performance indicators</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {metrics.map((metric, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="text-sm font-medium">{metric.label}</div>
              <div
                className={`text-sm ${
                  metric.isPositive === true ? "text-green-500" : metric.isPositive === false ? "text-red-500" : ""
                }`}
              >
                {metric.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
