"use client"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Clock, Activity, RefreshCw } from "lucide-react"
import type { Strategy } from "../types"

interface TradingDetailsProps {
  strategy: Strategy
}

export function TradingDetails({ strategy }: TradingDetailsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">Time in Market</span>
        </div>
        <span className="text-sm font-medium">{strategy.timeInMarket}%</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">Trades per Day</span>
        </div>
        <span className="text-sm font-medium">{strategy.tradesPerDay.toFixed(1)}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">Last Updated</span>
        </div>
        <span className="text-sm font-medium">{strategy.lastUpdated}</span>
      </div>

      <Separator />

      <div>
        <div className="mb-1 text-sm">Supported Exchanges</div>
        <div className="flex flex-wrap gap-1">
          {strategy.supportedExchanges.map((exchange) => (
            <Badge key={exchange} variant="outline" className="text-xs">
              {exchange}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm">Supported Pairs</div>
        <div className="flex flex-wrap gap-1">
          {strategy.supportedPairs.map((pair) => (
            <Badge key={pair} variant="outline" className="text-xs">
              {pair}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  )
}
