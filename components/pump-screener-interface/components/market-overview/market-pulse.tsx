"use client"

import { TrendingUp, TrendingDown, Activity, DollarSign } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type { MarketOverview } from "../../types"

interface MarketPulseProps {
  marketOverview: MarketOverview
  isConnected: boolean
}

export function MarketPulse({ marketOverview, isConnected }: MarketPulseProps) {
  const getFearGreedColor = (index: number) => {
    if (index >= 75) return "text-red-500"
    if (index >= 55) return "text-orange-500"
    if (index >= 45) return "text-yellow-500"
    if (index >= 25) return "text-blue-500"
    return "text-green-500"
  }

  const getFearGreedBg = (index: number) => {
    if (index >= 75) return "bg-red-500"
    if (index >= 55) return "bg-orange-500"
    if (index >= 45) return "bg-yellow-500"
    if (index >= 25) return "bg-blue-500"
    return "bg-green-500"
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Market Pulse
        </CardTitle>
        <CardDescription>Real-time market sentiment and activity</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fear & Greed Index */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Fear & Greed Index</span>
            <Badge variant="outline" className={getFearGreedColor(marketOverview.fearGreedIndex)}>
              {marketOverview.fearGreedLabel}
            </Badge>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Extreme Fear</span>
              <span>Extreme Greed</span>
            </div>
            <div className="relative">
              <Progress value={marketOverview.fearGreedIndex} className="h-2" />
              <div
                className={`absolute top-0 h-2 w-1 ${getFearGreedBg(marketOverview.fearGreedIndex)} rounded-full`}
                style={{ left: `${marketOverview.fearGreedIndex}%` }}
              />
            </div>
            <div className="text-center">
              <span className={`text-2xl font-bold ${getFearGreedColor(marketOverview.fearGreedIndex)}`}>
                {marketOverview.fearGreedIndex}
              </span>
            </div>
          </div>
        </div>

        {/* Market Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              Total Market Cap
            </div>
            <p className="text-lg font-semibold">${marketOverview.totalMarketCap}T</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Activity className="h-3 w-3" />
              24h Volume
            </div>
            <p className="text-lg font-semibold">${marketOverview.total24hVolume}B</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-500" />
              Pumping
            </div>
            <p className="text-lg font-semibold text-green-500">{marketOverview.pumpingCoins}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <TrendingDown className="h-3 w-3 text-red-500" />
              Dumping
            </div>
            <p className="text-lg font-semibold text-red-500">{marketOverview.dumpingCoins}</p>
          </div>
        </div>

        {/* BTC Dominance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">BTC Dominance</span>
            <span className="text-sm font-semibold">{marketOverview.btcDominance}%</span>
          </div>
          <Progress value={marketOverview.btcDominance} className="h-2" />
        </div>

        {/* Connection Status */}
        <div className="flex items-center justify-center pt-2">
          <Badge variant={isConnected ? "default" : "destructive"}>
            {isConnected ? "🟢 Live Data" : "🔴 Disconnected"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
