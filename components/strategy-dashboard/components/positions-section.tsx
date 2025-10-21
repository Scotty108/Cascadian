"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatShares, formatPercentage } from "../utils"
import type { Position } from "../types"
import { TrendingUp, TrendingDown } from "lucide-react"

interface PositionsSectionProps {
  positions: Position[]
}

export function PositionsSection({ positions }: PositionsSectionProps) {
  const openPositions = positions.filter(p => p.status === "open")
  const closedPositions = positions.filter(p => p.status === "closed")

  return (
    <div className="space-y-4">
      {/* Open Positions */}
      <Card>
        <CardHeader>
          <CardTitle>Open Positions ({openPositions.length})</CardTitle>
          <CardDescription>Currently active positions in prediction markets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {openPositions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No open positions
              </div>
            ) : (
              openPositions.map((position) => {
                const pnlPercentage = ((position.currentPrice - position.averagePrice) / position.averagePrice) * 100
                const isProfitable = position.unrealizedPnL >= 0

                return (
                  <div
                    key={position.id}
                    className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-medium line-clamp-2">{position.marketTitle}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={position.outcome === "YES" ? "default" : "secondary"}>
                            {position.outcome}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{position.category}</span>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <div className={`text-lg font-bold ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(position.unrealizedPnL)}
                        </div>
                        <div className={`text-sm flex items-center justify-end ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                          {isProfitable ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                          {formatPercentage(pnlPercentage)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-3 pt-3 border-t">
                      <div>
                        <div className="text-muted-foreground">Shares</div>
                        <div className="font-medium">{formatShares(position.shares)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Avg Price</div>
                        <div className="font-medium">{formatCurrency(position.averagePrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Current Price</div>
                        <div className="font-medium">{formatCurrency(position.currentPrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Value</div>
                        <div className="font-medium">{formatCurrency(position.shares * position.currentPrice)}</div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-3">
                      <Button variant="outline" size="sm">
                        View Market
                      </Button>
                      <Button variant="default" size="sm">
                        Close Position
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recently Closed Positions */}
      {closedPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently Closed Positions ({closedPositions.length})</CardTitle>
            <CardDescription>Last 10 closed positions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {closedPositions.slice(0, 10).map((position) => {
                const isProfitable = position.realizedPnL >= 0

                return (
                  <div
                    key={position.id}
                    className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h5 className="font-medium text-sm line-clamp-1">{position.marketTitle}</h5>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={position.outcome === "YES" ? "default" : "secondary"} className="text-xs">
                            {position.outcome}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{position.category}</span>
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <div className={`font-bold ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(position.realizedPnL)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
