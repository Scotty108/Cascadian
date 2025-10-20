"use client"

import { Brain, Clock, Eye } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatDate } from "../utils"
import type { AiInsight } from "../types"

interface AiInsightsProps {
  insights: AiInsight[]
  onViewAll: () => void
}

export function AiInsights({ insights, onViewAll }: AiInsightsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">AI Insights</CardTitle>
          <CardDescription>Recent actions and recommendations from the AI</CardDescription>
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={onViewAll}>
          <Eye className="h-4 w-4" />
          <span>View All</span>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {insights.map((insight) => (
            <div key={insight.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
              <div
                className={cn(
                  "mt-0.5 rounded-full p-1",
                  insight.impact === "positive" && "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400",
                  insight.impact === "negative" && "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400",
                  insight.impact === "neutral" && "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400",
                )}
              >
                <Brain className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm">{insight.message}</div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{formatDate(insight.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
