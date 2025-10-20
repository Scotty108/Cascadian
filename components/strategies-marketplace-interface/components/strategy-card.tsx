"use client"

import { memo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Heart,
  ChevronRight,
  Brain,
  TrendingUp,
  RefreshCw,
  ArrowUpRight,
  Zap,
  Sliders,
  Clock,
  Repeat,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Strategy } from "../types"
import { getRiskColor, getReturnColor, formatPrice, formatNumber, formatPercentage } from "../utils"
import { StarRating } from "./star-rating"
import { CreatorInfo } from "./creator-info"
import { PerformanceChart } from "./performance-chart"

interface StrategyCardProps {
  strategy: Strategy
  onToggleFavorite: (id: string) => void
  onViewDetails: (strategy: Strategy) => void
}

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "AI-Powered":
      return <Brain className="h-3 w-3" />
    case "Trend Following":
      return <TrendingUp className="h-3 w-3" />
    case "Mean Reversion":
      return <RefreshCw className="h-3 w-3" />
    case "Breakout":
      return <ArrowUpRight className="h-3 w-3" />
    case "Scalping":
      return <Zap className="h-3 w-3" />
    case "Grid Trading":
      return <Sliders className="h-3 w-3" />
    case "DCA":
      return <Clock className="h-3 w-3" />
    case "Arbitrage":
      return <Repeat className="h-3 w-3" />
    default:
      return <Brain className="h-3 w-3" />
  }
}

const getReturnIcon = (value: number) => {
  if (value > 0) return <ArrowUpRight className="h-3 w-3" />
  if (value < 0) return <ArrowUpRight className="h-3 w-3 rotate-180" />
  return null
}

export const StrategyCard = memo(function StrategyCard({
  strategy,
  onToggleFavorite,
  onViewDetails,
}: StrategyCardProps) {
  return (
    <Card className="overflow-hidden transition-all hover:shadow-md">
      <CardHeader className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="line-clamp-1">{strategy.name}</CardTitle>
            <CardDescription className="line-clamp-2 mt-1">{strategy.description}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onToggleFavorite(strategy.id)}
          >
            <Heart
              className={cn("h-4 w-4", strategy.isFavorite ? "fill-red-500 text-red-500" : "text-muted-foreground")}
            />
            <span className="sr-only">Toggle favorite</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0">
        <div className="mb-4 flex flex-wrap gap-1">
          <Badge variant="secondary" className="gap-1">
            {getCategoryIcon(strategy.category)}
            {strategy.category}
          </Badge>
          {strategy.isFree && (
            <Badge variant="outline" className="border-green-500 text-green-500">
              Free
            </Badge>
          )}
          {strategy.isNew && <Badge className="bg-blue-500 text-white hover:bg-blue-600">New</Badge>}
          {strategy.isTrending && (
            <Badge variant="outline" className="border-orange-500 text-orange-500">
              Trending
            </Badge>
          )}
        </div>

        <div className="mb-4">
          <PerformanceChart strategy={strategy} height={120} />

          <div className="mt-2 flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Monthly Return</div>
              <div
                className={cn(
                  "flex items-center gap-1 text-lg font-semibold",
                  getReturnColor(strategy.returns.monthly),
                )}
              >
                {getReturnIcon(strategy.returns.monthly)}
                {formatPercentage(strategy.returns.monthly)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Win Rate</div>
              <div className="text-lg font-semibold">{strategy.winRate.toFixed(1)}%</div>
            </div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-muted-foreground">Risk Level</div>
            <div className={cn("text-sm font-medium", getRiskColor(strategy.risk))}>{strategy.risk}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Rating</div>
            <div className="text-sm">
              <StarRating rating={strategy.rating} size="sm" />
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Creator</div>
            <CreatorInfo creator={strategy.creator} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Users</div>
            <div className="text-sm font-medium">{formatNumber(strategy.purchases)}</div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between border-t p-4">
        <div>
          <div className="text-xs text-muted-foreground">Price</div>
          <div className="text-lg font-bold">
            {formatPrice(strategy.price)}
            {strategy.subscription && <span className="text-xs font-normal text-muted-foreground"> /year</span>}
          </div>
        </div>
        <Button className="gap-1" onClick={() => onViewDetails(strategy)}>
          <span>Details</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  )
})
