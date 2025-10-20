import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { RiskMetric } from "../../types"

interface RiskAssessmentProps {
  metrics: RiskMetric[]
}

export function RiskAssessment({ metrics }: RiskAssessmentProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk Assessment</CardTitle>
        <CardDescription>Portfolio risk analysis</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {metrics.map((metric, index) => (
            <div key={index}>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-sm font-medium">{metric.label}</div>
                <div className="text-sm text-muted-foreground">{metric.value}</div>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div className={`h-2 rounded-full ${metric.color}`} style={{ width: `${metric.percentage}%` }} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
