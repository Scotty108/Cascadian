import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { KpiMetric } from "../types"

interface KpiCardsProps {
  metrics: KpiMetric[]
}

export function KpiCards({ metrics }: KpiCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => (
        <Card key={index}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
            <metric.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metric.value}</div>
            <p className={`text-xs ${metric.isPositive ? "text-green-500" : "text-red-500"}`}>{metric.change}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
