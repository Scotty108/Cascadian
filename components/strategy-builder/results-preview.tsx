"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CheckCircle2, XCircle, Clock, TrendingUp, Users, DollarSign, Activity } from "lucide-react"
import type { StrategyResult } from "@/lib/strategy-builder/types"
import { CoverageBadge } from "@/components/ui/coverage-badge"
import { getSignalWalletByAddress } from "@/lib/data/wallet-signal-set"

interface ResultsPreviewProps {
  result: StrategyResult | null
  loading?: boolean
}

export function ResultsPreview({ result, loading }: ResultsPreviewProps) {
  if (loading) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 animate-spin text-[#00E0AA]" />
            <CardTitle>Executing Strategy...</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!result) {
    return (
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle>Execution Results</CardTitle>
          <CardDescription>Run a strategy to see results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No results yet</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const statusIcon = result.status === "SUCCESS" ? (
    <CheckCircle2 className="h-5 w-5 text-green-500" />
  ) : (
    <XCircle className="h-5 w-5 text-red-500" />
  )

  const statusBadge = result.status === "SUCCESS" ? (
    <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
      Success
    </Badge>
  ) : (
    <Badge variant="destructive">Failed</Badge>
  )

  // Extract wallet results from node results
  const walletResults: any[] = []
  Object.values(result.results).forEach((nodeResult) => {
    if (Array.isArray(nodeResult.data) && nodeResult.data.length > 0) {
      const firstItem = nodeResult.data[0]
      if (firstItem && "wallet_address" in firstItem) {
        walletResults.push(...nodeResult.data)
      }
    }
  })

  // Get unique wallets (in case same wallet appears in multiple nodes)
  const allUniqueWallets = Array.from(
    new Map(walletResults.map((w) => [w.wallet_address, w])).values()
  )

  // GOVERNANCE: Only show signal wallets (with coverage_pct)
  // Filter out wallets without coverage data
  const uniqueWallets = allUniqueWallets
    .map((wallet) => {
      const signalWallet = getSignalWalletByAddress(wallet.wallet_address)
      if (!signalWallet) return null
      return {
        ...wallet,
        coveragePct: signalWallet.coveragePct,
      }
    })
    .filter((w) => w !== null)

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {statusIcon}
            <CardTitle>Execution Results</CardTitle>
          </div>
          {statusBadge}
        </div>
        <CardDescription>
          Executed in {result.totalExecutionTimeMs}ms
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Nodes Evaluated</div>
            <div className="text-2xl font-bold">{result.nodesEvaluated}</div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Data Points</div>
            <div className="text-2xl font-bold">{result.dataPointsProcessed.toLocaleString()}</div>
          </div>
        </div>

        {/* Error Message */}
        {result.errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <div className="text-sm text-red-600 dark:text-red-400">
              <strong>Error:</strong> {result.errorMessage}
            </div>
          </div>
        )}

        {/* Aggregations */}
        {result.aggregations && Object.keys(result.aggregations).length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Aggregations
            </h4>
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              {Object.entries(result.aggregations).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{key}:</span>
                  <span className="font-mono font-semibold">
                    {typeof value === "number" ? value.toLocaleString() : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Matched Wallets */}
        {uniqueWallets.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              Matched Wallets ({uniqueWallets.length})
            </h4>
            <ScrollArea className="h-[300px] rounded-lg border border-border/60">
              <div className="space-y-2 p-3">
                {uniqueWallets.slice(0, 50).map((wallet, index) => (
                  <div
                    key={wallet.wallet_address || index}
                    className="bg-muted/50 rounded-lg p-3 space-y-1 hover:bg-muted transition"
                  >
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-xs text-muted-foreground truncate flex-1">
                        {wallet.wallet_address}
                      </div>
                      <CoverageBadge coveragePct={wallet.coveragePct} showIcon={false} variant="minimal" />
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {wallet.omega_ratio !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">Omega:</span>
                          <span className="font-semibold text-[#00E0AA]">
                            {wallet.omega_ratio.toFixed(2)}
                          </span>
                        </div>
                      )}
                      {wallet.net_pnl !== null && (
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          <span className={wallet.net_pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                            {wallet.net_pnl >= 0 ? "+" : ""}
                            {wallet.net_pnl.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}
                          </span>
                        </div>
                      )}
                      {wallet.win_rate !== null && (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">WR:</span>
                          <span className="font-semibold">
                            {(wallet.win_rate * 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {uniqueWallets.length > 50 && (
                  <div className="text-center text-sm text-muted-foreground py-2">
                    Showing 50 of {uniqueWallets.length} wallets
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Signals Generated */}
        {result.signalsGenerated && result.signalsGenerated.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Signals Generated ({result.signalsGenerated.length})
            </h4>
            <div className="space-y-2">
              {result.signalsGenerated.map((signal: any, index: number) => (
                <div key={index} className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        signal.signalType === "ENTRY"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : signal.signalType === "EXIT"
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                      }
                    >
                      {signal.signalType}
                    </Badge>
                    {signal.direction && (
                      <span className="text-sm text-muted-foreground">
                        {signal.direction}
                      </span>
                    )}
                    {signal.strength && (
                      <Badge variant="outline" className="text-xs">
                        {signal.strength}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions Executed */}
        {result.actionsExecuted && result.actionsExecuted.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold">Actions Executed ({result.actionsExecuted.length})</h4>
            <div className="space-y-2">
              {result.actionsExecuted.map((action: any, index: number) => (
                <div key={index} className="bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="font-medium">{action.action}</div>
                  {action.count && (
                    <div className="text-muted-foreground">Count: {action.count}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
