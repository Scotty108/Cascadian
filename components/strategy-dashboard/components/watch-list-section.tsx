"use client"

import { Eye, TrendingUp, TrendingDown, AlertCircle, Radio, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { formatCurrency, formatDateTime, formatPercentage } from "../utils"

export interface WatchSignal {
  id: string
  marketId: string
  marketTitle: string
  category: string
  currentPrice: number
  sii: number
  volume24h: number
  momentum: number
  flaggedAt: string
  reason: string
  confidence: "high" | "medium" | "low"
  suggestedOutcome: "YES" | "NO"
}

interface WatchListSectionProps {
  signals: WatchSignal[]
}

export function WatchListSection({ signals }: WatchListSectionProps) {
  const highConfidenceSignals = signals.filter(s => s.confidence === "high")

  return (
    <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
      <CardHeader className="flex flex-col gap-2 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg font-semibold">Watch List</CardTitle>
          <CardDescription>
            Markets flagged by strategy signals for potential entry
          </CardDescription>
        </div>
        <Badge className="rounded-full bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {signals.length} watching
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {signals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-muted p-6 mb-4">
              <Radio className="h-12 w-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Signals Yet</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              When your strategy identifies markets or wallets that match your criteria, they'll appear here.
            </p>
            <Button variant="outline" onClick={() => window.location.href = '/strategy-builder'}>
              <Play className="h-4 w-4 mr-2" />
              Deploy Strategy
            </Button>
          </div>
        ) : (
          <>
            {highConfidenceSignals.length > 0 && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 mb-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {highConfidenceSignals.length} high-confidence {highConfidenceSignals.length === 1 ? 'signal' : 'signals'}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                      These markets meet all entry criteria and are ready for position entry.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {signals.map(signal => {
              const isPositiveMomentum = signal.momentum > 0
              const isHighSii = Math.abs(signal.sii) > 50

              return (
                <div
                  key={signal.id}
                  className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-5 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-3 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={signal.suggestedOutcome === "YES" ? "default" : "secondary"}>
                          {signal.suggestedOutcome}
                        </Badge>
                        <Badge variant="outline">
                          {signal.category}
                        </Badge>
                        <Badge
                          variant={signal.confidence === "high" ? "default" : "outline"}
                          className={signal.confidence === "high" ? "bg-blue-600" : ""}
                        >
                          {signal.confidence} confidence
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Flagged {formatDateTime(signal.flaggedAt)}
                        </span>
                      </div>
                      <h4 className="text-base font-medium">
                        {signal.marketTitle}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {signal.reason}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-muted-foreground mb-1">Current Price</div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(signal.currentPrice)}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        SII Signal
                      </p>
                      <p className={`text-base font-semibold ${isHighSii ? 'text-green-600' : ''}`}>
                        {signal.sii > 0 ? '+' : ''}{signal.sii}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Momentum
                      </p>
                      <div className="flex items-center gap-1">
                        {isPositiveMomentum ? (
                          <TrendingUp className="h-4 w-4 text-green-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-600" />
                        )}
                        <p className={`text-base font-semibold ${isPositiveMomentum ? 'text-green-600' : 'text-red-600'}`}>
                          {formatPercentage(signal.momentum)}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        24h Volume
                      </p>
                      <p className="text-base font-semibold">
                        {formatCurrency(signal.volume24h)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Suggested Entry
                      </p>
                      <p className="text-base font-semibold">
                        {formatCurrency(signal.currentPrice * 0.98)} - {formatCurrency(signal.currentPrice * 1.02)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                      Auto-flagged by strategy rules
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm">
                        View market
                      </Button>
                      <Button size="sm">
                        Enter position
                      </Button>
                      <Button variant="ghost" size="sm">
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </CardContent>
    </Card>
  )
}
