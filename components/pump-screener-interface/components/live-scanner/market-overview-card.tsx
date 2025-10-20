"use client"

import { TrendingUp, TrendingDown, Activity, Users, Wifi, WifiOff } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { MarketOverview } from "../../types"

interface MarketOverviewCardProps {
  marketOverview: MarketOverview
  isConnected: boolean
  lastUpdate: number
}

export function MarketOverviewCard({ marketOverview, isConnected, lastUpdate }: MarketOverviewCardProps) {
  const formatLastUpdate = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp

    if (diff < 60000) return "Just now"
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    return `${Math.floor(diff / 3600000)}h ago`
  }

  const getFearGreedColor = (index: number) => {
    if (index >= 75) return "text-red-500"
    if (index >= 55) return "text-orange-500"
    if (index >= 45) return "text-yellow-500"
    if (index >= 25) return "text-blue-500"
    return "text-green-500"
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Market Overview</CardTitle>
          <div className="flex items-center gap-2">
            {isConnected ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
            <span className="text-xs text-muted-foreground">{formatLastUpdate(lastUpdate)}</span>
          </div>
        </div>
        <CardDescription>Real-time cryptocurrency market statistics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Market Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Market Cap</p>
            <p className="text-lg font-semibold">${marketOverview.totalMarketCap}T</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">24h Volume</p>
            <p className="text-lg font-semibold">${marketOverview.total24hVolume}B</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">BTC Dominance</p>
            <p className="text-lg font-semibold">{marketOverview.btcDominance}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Fear & Greed</p>
            <p className={`text-lg font-semibold ${getFearGreedColor(marketOverview.fearGreedIndex)}`}>
              {marketOverview.fearGreedIndex} ({marketOverview.fearGreedLabel})
            </p>
          </div>
        </div>

        {/* Activity Stats */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-sm">Pumping Coins</span>
            </div>
            <Badge variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30">
              {marketOverview.pumpingCoins}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className="text-sm">Dumping Coins</span>
            </div>
            <Badge variant="outline" className="bg-red-500/20 text-red-600 border-red-500/30">
              {marketOverview.dumpingCoins}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-orange-500" />
              <span className="text-sm">Unusual Activity</span>
            </div>
            <Badge variant="outline" className="bg-orange-500/20 text-orange-600 border-orange-500/30">
              {marketOverview.unusualActivity}
            </Badge>
          </div>
        </div>

        {/* Social Trending */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="text-sm font-medium">Social Trending</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {marketOverview.socialTrending.map((coin, index) => (
              <Badge key={coin} variant="secondary" className="text-xs">
                #{index + 1} {coin}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
