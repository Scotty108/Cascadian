"use client"

import { Star, ExternalLink, TrendingUp, Volume2, Clock, Shield, Users, BarChart3 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { RiskBadge } from "../shared/risk-badge"
import { formatNumber, formatRelativeTime } from "../../utils"
import type { PumpAlert } from "../../types"

interface AlertDetailsCardProps {
  alert: PumpAlert
  isFavorite: boolean
  onToggleFavorite: () => void
}

export function AlertDetailsCard({ alert, isFavorite, onToggleFavorite }: AlertDetailsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3 ">
        <div className="flex items-center flex-wrap gap-3 justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              {alert.symbol}
              <Badge variant="outline">{alert.exchange}</Badge>
            </CardTitle>
            <CardDescription>
              Detected {formatRelativeTime(alert.timestamp)} • Pattern: {alert.patternType}
            </CardDescription>
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleFavorite}
              className={isFavorite ? "text-yellow-500" : ""}
            >
              <Star className={`h-4 w-4 mr-1 ${isFavorite ? "fill-current" : ""}`} />
              {isFavorite ? "Favorited" : "Add to Favorites"}
            </Button>
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4 mr-1" />
              View on Exchange
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="flex justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              Price Change
            </div>
            <p className="text-lg font-semibold text-green-500">+{alert.priceChange}%</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Volume2 className="h-3 w-3" />
              Volume Change
            </div>
            <p className="text-lg font-semibold">+{alert.volumeChange}%</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-3 w-3" />
              Time Frame
            </div>
            <Badge variant="outline">{alert.timeFrame}</Badge>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Shield className="h-3 w-3" />
              Risk Level
            </div>
            <RiskBadge risk={alert.risk} />
          </div>
        </div>

        <Separator />

        {/* Detailed Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="font-medium">Market Data</h4>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Current Price</span>
                <span className="font-medium">${alert.currentPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Market Cap</span>
                <span className="font-medium">{formatNumber(alert.marketCap)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">24h Volume</span>
                <span className="font-medium">{formatNumber(alert.volume24h)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">Analysis</h4>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Confidence Score</span>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${alert.confidence}%` }}
                    />
                  </div>
                  <span className="font-medium">{alert.confidence}%</span>
                </div>
              </div>
              <div className="flex justify-between">
                <div className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  <span className="text-sm text-muted-foreground">Social Mentions</span>
                </div>
                <span className="font-medium">{alert.socialMentions.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <div className="flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  <span className="text-sm text-muted-foreground">Previous Pumps</span>
                </div>
                <span className="font-medium">{alert.previousPumps}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pattern Analysis */}
        <div className="space-y-3">
          <h4 className="font-medium">Pattern Analysis</h4>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-sm">
              <strong>{alert.patternType}</strong> detected with {alert.confidence}% confidence. This asset has
              experienced {alert.previousPumps} similar patterns in recent history.
              {alert.risk === "very high" && " ⚠️ High risk - exercise extreme caution."}
              {alert.risk === "high" && " ⚠️ Elevated risk - trade carefully."}
              {alert.risk === "medium" && " ℹ️ Moderate risk - standard precautions apply."}
              {alert.risk === "low" && " ✅ Lower risk - but always DYOR."}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button className="flex-1">
            <TrendingUp className="h-4 w-4 mr-2" />
            Set Price Alert
          </Button>
          <Button variant="outline" className="flex-1">
            <BarChart3 className="h-4 w-4 mr-2" />
            View Chart
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
