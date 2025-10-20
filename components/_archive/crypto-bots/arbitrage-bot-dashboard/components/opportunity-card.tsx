"use client"

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Zap, Check, X, ArrowRight, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ArbitrageOpportunity } from "../types"

interface OpportunityCardProps {
  opportunity: ArbitrageOpportunity
  onExecute?: (opportunityId: string) => void
  onViewDetails?: (opportunity: ArbitrageOpportunity) => void
}

export function OpportunityCard({ opportunity, onExecute, onViewDetails }: OpportunityCardProps) {
  return (
    <Card
      className={cn(
        "transition-all hover:shadow-md",
        opportunity.status === "active" && "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20",
        opportunity.status === "completed" && "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20",
        opportunity.status === "failed" && "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20",
      )}
    >
      <CardHeader className="p-4 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Badge
              variant={
                opportunity.status === "active"
                  ? "default"
                  : opportunity.status === "completed"
                    ? "secondary"
                    : "destructive"
              }
              className="px-2 py-0"
            >
              {opportunity.status === "active" ? (
                <Zap className="mr-1 h-3 w-3" />
              ) : opportunity.status === "completed" ? (
                <Check className="mr-1 h-3 w-3" />
              ) : (
                <X className="mr-1 h-3 w-3" />
              )}
              {opportunity.status.charAt(0).toUpperCase() + opportunity.status.slice(1)}
            </Badge>
          </div>
          <div className="text-sm font-medium">{opportunity.pair}</div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center space-x-1 text-sm">
            <span className="font-medium">{opportunity.buyExchange}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="font-medium">{opportunity.sellExchange}</span>
          </div>
          <div className="text-sm font-bold text-green-600 dark:text-green-400">+${opportunity.profit.toFixed(2)}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Spread</div>
            <div className="font-medium">{opportunity.spread.toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Volume</div>
            <div className="font-medium">${opportunity.volume.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Time</div>
            <div className="font-medium">
              {opportunity.status === "active"
                ? "Now"
                : opportunity.executionTime
                  ? `${opportunity.executionTime}s`
                  : "Failed"}
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 p-4 pt-0">
        {opportunity.status === "active" ? (
          <>
            <Button size="sm" variant="default" className="flex-1" onClick={() => onExecute?.(opportunity.id)}>
              <Zap className="mr-1 h-3 w-3" />
              Execute
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onViewDetails?.(opportunity)}>
              <Eye className="mr-1 h-3 w-3" />
              Details
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => onViewDetails?.(opportunity)}>
            <Eye className="mr-1 h-3 w-3" />
            View Details
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
