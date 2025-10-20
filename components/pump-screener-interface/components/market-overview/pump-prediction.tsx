"use client"

import { Brain, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { RiskBadge } from "../shared/risk-badge"
import { mockPumpPredictions } from "../../data"

export function PumpPrediction() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Pump Predictions
        </CardTitle>
        <CardDescription>Machine learning powered pump likelihood analysis</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mockPumpPredictions.map((prediction, index) => (
          <div key={index} className="space-y-3 p-3 border rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{prediction.symbol}</span>
                <span className="text-sm text-muted-foreground">{prediction.name}</span>
              </div>
              <RiskBadge risk={prediction.risk} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Pump Likelihood</span>
                <span className="text-sm font-medium">{prediction.likelihood}%</span>
              </div>
              <Progress value={prediction.likelihood} className="h-2" />
            </div>

            <p className="text-xs text-muted-foreground">{prediction.reasoning}</p>
          </div>
        ))}

        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <p className="text-xs text-muted-foreground">
            Predictions are based on historical data and should not be considered financial advice. Always DYOR.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
