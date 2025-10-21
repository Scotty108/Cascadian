"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatShares, formatDateTime } from "../utils"
import type { Trade } from "../types"
import { ArrowDownRight, ArrowUpRight, Clock, CheckCircle2, XCircle } from "lucide-react"

interface TradesSectionProps {
  trades: Trade[]
}

export function TradesSection({ trades }: TradesSectionProps) {
  const sortedTrades = [...trades].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Trades ({trades.length})</CardTitle>
        <CardDescription>Latest trading activity for this strategy</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sortedTrades.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No trades yet
            </div>
          ) : (
            sortedTrades.map((trade) => {
              const isBuy = trade.type === "buy"
              const isProfitable = trade.pnl !== undefined && trade.pnl >= 0

              return (
                <div
                  key={trade.id}
                  className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`p-2 rounded-md ${isBuy ? 'bg-green-100 dark:bg-green-900/20' : 'bg-red-100 dark:bg-red-900/20'}`}>
                        {isBuy ? (
                          <ArrowUpRight className={`h-4 w-4 ${isBuy ? 'text-green-600' : 'text-red-600'}`} />
                        ) : (
                          <ArrowDownRight className={`h-4 w-4 ${isBuy ? 'text-green-600' : 'text-red-600'}`} />
                        )}
                      </div>

                      <div className="flex-1">
                        <h5 className="font-medium text-sm line-clamp-1">{trade.marketTitle}</h5>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant={isBuy ? "default" : "secondary"} className="text-xs">
                            {trade.type.toUpperCase()}
                          </Badge>
                          <Badge variant={trade.outcome === "YES" ? "outline" : "secondary"} className="text-xs">
                            {trade.outcome}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatShares(trade.shares)} shares @ {formatCurrency(trade.price)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDateTime(trade.timestamp)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right ml-4">
                      <div className="font-bold">{formatCurrency(trade.amount)}</div>
                      {trade.pnl !== undefined && (
                        <div className={`text-sm flex items-center justify-end mt-1 ${isProfitable ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(trade.pnl)}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-1 mt-1">
                        {trade.status === "completed" && (
                          <div className="flex items-center text-xs text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Completed
                          </div>
                        )}
                        {trade.status === "pending" && (
                          <div className="flex items-center text-xs text-yellow-600">
                            <Clock className="h-3 w-3 mr-1" />
                            Pending
                          </div>
                        )}
                        {trade.status === "failed" && (
                          <div className="flex items-center text-xs text-red-600">
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}
