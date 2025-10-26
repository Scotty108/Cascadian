"use client"

import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  XCircle,
  History,
  Play,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { ACCENT_COLOR, formatCurrency, formatDateTime, formatShares } from "../utils"
import type { Trade } from "../types"

interface TradesSectionProps {
  trades: Trade[]
}

export function TradesSection({ trades }: TradesSectionProps) {
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  const accentColor = ACCENT_COLOR

  return (
    <Card className="rounded-3xl border border-border/60 bg-background/60 shadow-sm">
      <CardHeader className="flex flex-col gap-2 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg font-semibold">Recent trades</CardTitle>
          <CardDescription>Execution journal updated in real-time</CardDescription>
        </div>
        <Badge className="rounded-full bg-muted px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {sortedTrades.length} logged
        </Badge>
      </CardHeader>
      <CardContent>
        {sortedTrades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-muted p-6 mb-4">
              <History className="h-12 w-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Trade History</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              Your strategy's trading activity will be recorded here once you start executing trades.
            </p>
            <Button variant="outline" onClick={() => window.location.href = '/strategy-builder'}>
              <Play className="h-4 w-4 mr-2" />
              Deploy Strategy
            </Button>
          </div>
        ) : (
          <div className="relative space-y-4 pl-6">
            <div className="absolute left-2 top-4 bottom-4 w-px bg-border/50" aria-hidden />
            {sortedTrades.map(trade => {
                const isBuy = trade.type === "buy"
                const pnlDefined = typeof trade.pnl === "number"
                const isProfitable = !!trade.pnl && trade.pnl >= 0

                return (
                  <div
                    key={trade.id}
                    className="relative overflow-hidden rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-md"
                  >
                    <span
                      className="absolute -left-[34px] top-6 h-3 w-3 rounded-full border-2 border-background shadow"
                      style={{
                        backgroundColor: isBuy ? accentColor : "#f97316",
                        boxShadow: `0 0 0 3px ${isBuy ? `${accentColor}33` : "rgba(249,115,22,0.25)"}`,
                      }}
                    />

                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide">
                          <Badge
                            variant="outline"
                            className="rounded-full px-3 py-1"
                            style={{
                              borderColor: `${(isBuy ? accentColor : "#f97316")}45`,
                              backgroundColor: `${(isBuy ? accentColor : "#f97316")}12`,
                              color: isBuy ? accentColor : "#f97316",
                            }}
                          >
                            {isBuy ? (
                              <>
                                <ArrowUpRight className="mr-1 h-3 w-3" />
                                Buy
                              </>
                            ) : (
                              <>
                                <ArrowDownRight className="mr-1 h-3 w-3" />
                                Sell
                              </>
                            )}
                          </Badge>
                          <Badge
                            variant={trade.outcome === "YES" ? "default" : "secondary"}
                            className="rounded-full px-3 py-1"
                          >
                            {trade.outcome}
                          </Badge>
                          <span className="text-muted-foreground">{formatDateTime(trade.timestamp)}</span>
                        </div>
                        <p className="max-w-xl text-sm font-semibold leading-snug text-foreground">
                          {trade.marketTitle}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{formatShares(trade.shares)} shares</span>
                          <span>@ {formatCurrency(trade.price)}</span>
                          <span>Order value {formatCurrency(trade.amount)}</span>
                          {trade.fees > 0 && <span>Fees {formatCurrency(trade.fees)}</span>}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 text-sm font-semibold">
                        {pnlDefined && (
                          <span
                            className="inline-flex items-center gap-2 rounded-full px-3 py-1"
                            style={{
                              backgroundColor: isProfitable ? `${accentColor}12` : "rgba(239,68,68,0.1)",
                              color: isProfitable ? accentColor : "#ef4444",
                              boxShadow: isProfitable ? `inset 0 0 0 1px ${accentColor}21` : undefined,
                            }}
                          >
                            {isProfitable ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {formatCurrency(trade.pnl ?? 0)}
                          </span>
                        )}
                        <div className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          {trade.status === "completed" && (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                              Completed
                            </>
                          )}
                          {trade.status === "pending" && (
                            <>
                              <Clock className="h-3 w-3 text-amber-500" />
                              Pending
                            </>
                          )}
                          {trade.status === "failed" && (
                            <>
                              <XCircle className="h-3 w-3 text-red-500" />
                              Failed
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
