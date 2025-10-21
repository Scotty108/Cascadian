"use client"

import { TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { ACCENT_COLOR, formatCurrency, formatDateTime, formatPercentage, formatShares } from "../utils"
import type { Position } from "../types"

interface PositionsSectionProps {
  positions: Position[]
}

export function PositionsSection({ positions }: PositionsSectionProps) {
  const openPositions = positions.filter(position => position.status === "open")
  const closedPositions = positions.filter(position => position.status === "closed")
  const accentColor = ACCENT_COLOR

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
        <CardHeader className="flex flex-col gap-2 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Open Positions</CardTitle>
            <CardDescription>
              Active exposure across live prediction markets
            </CardDescription>
          </div>
          <Badge className="rounded-full bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {openPositions.length} live
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {openPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
              No open positions right now. Your strategy will surface new opportunities automatically.
            </div>
          ) : (
            openPositions.map(position => {
              const pnlPercentage =
                ((position.currentPrice - position.averagePrice) / position.averagePrice) * 100
              const isProfitable = position.unrealizedPnL >= 0
              const positionValue = position.shares * position.currentPrice

              return (
                <div
                  key={position.id}
                  className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-5 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={position.outcome === "YES" ? "default" : "secondary"}>
                          {position.outcome}
                        </Badge>
                        <Badge variant="outline">
                          {position.category}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Opened {formatDateTime(position.openedAt)}
                        </span>
                      </div>
                      <h4 className="text-base font-medium">
                        {position.marketTitle}
                      </h4>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-semibold ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(position.unrealizedPnL)}
                      </div>
                      <div className="mt-1 flex items-center justify-end gap-1 text-sm text-muted-foreground">
                        {isProfitable ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <TrendingDown className="h-4 w-4" />
                        )}
                        {formatPercentage(pnlPercentage)}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Shares
                      </p>
                      <p className="text-base font-semibold">{formatShares(position.shares)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Avg price
                      </p>
                      <p className="text-base font-semibold">{formatCurrency(position.averagePrice)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Current price
                      </p>
                      <p className="text-base font-semibold">{formatCurrency(position.currentPrice)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Position value
                      </p>
                      <p className="text-base font-semibold">{formatCurrency(positionValue)}</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                      Managed by Cascadian automations
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm">
                        View market
                      </Button>
                      <Button size="sm">
                        Close position
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {closedPositions.length > 0 && (
        <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
          <CardHeader className="flex flex-col gap-2 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">Recently closed</CardTitle>
              <CardDescription>Latest exits across the strategy (last 10)</CardDescription>
            </div>
            <Badge className="rounded-full bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {Math.min(closedPositions.length, 10)} shown
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {closedPositions.slice(0, 10).map(position => {
              const isProfitable = position.realizedPnL >= 0

              return (
                <div
                  key={position.id}
                  className="flex flex-col rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm transition hover:border-[#00E0AA]/40 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={position.outcome === "YES" ? "default" : "secondary"}>
                        {position.outcome}
                      </Badge>
                      <Badge variant="outline">
                        {position.category}
                      </Badge>
                      {position.closedAt && (
                        <span className="text-xs text-muted-foreground">
                          Closed {formatDateTime(position.closedAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium">
                      {position.marketTitle}
                    </p>
                  </div>
                  <div className={`mt-3 flex items-center gap-2 text-sm font-semibold sm:mt-0 ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                    {isProfitable ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {formatCurrency(position.realizedPnL)}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
