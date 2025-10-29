"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ArrowUpRight, ArrowDownRight, Clock, TrendingUp, Wallet, Activity } from "lucide-react"
import { useEffect, useState } from "react"

interface CopyTradingPerformance {
  summary: {
    total_trades: number
    active_positions: number
    win_rate: number
    total_pnl_usd: number
    avg_latency_seconds: number
  }
  recent_trades: Array<{
    id: number
    source_wallet: string
    market_id: string
    side: 'YES' | 'NO'
    our_entry_price: number
    our_shares: number
    our_usd_amount: number
    status: 'open' | 'closed'
    realized_pnl_usd: number | null
    unrealized_pnl_usd: number | null
    our_timestamp: string
    latency_seconds: number
    slippage_bps: number
  }>
  tracked_wallets: Array<{
    id: number
    wallet_address: string
    status: string
    trades_copied: number
    trades_skipped: number
    cumulative_pnl: number
    current_omega: number
    primary_category: string
    started_tracking_at: string
  }>
  daily_performance: Array<{
    date: string
    trades: number
    pnl_usd: number
    win_rate: number
  }>
}

interface CopyTradingSectionProps {
  strategyId: string
}

export function CopyTradingSection({ strategyId }: CopyTradingSectionProps) {
  const [data, setData] = useState<CopyTradingPerformance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [strategyId])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/strategies/${strategyId}/copy-trading/performance`)
      if (!response.ok) {
        throw new Error('Failed to fetch copy trading performance')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <CardContent className="px-6 py-12">
          <div className="flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#00E0AA] border-t-transparent" />
          </div>
          <p className="text-center text-sm text-muted-foreground mt-4">
            Loading copy trading data...
          </p>
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <CardContent className="px-6 py-12">
          <p className="text-center text-sm text-red-500">
            {error || 'No copy trading data available'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const { summary, recent_trades, tracked_wallets } = data

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <h3 className="text-2xl font-bold mt-2">{summary.total_trades}</h3>
              </div>
              <div className="h-12 w-12 rounded-full bg-[#00E0AA]/10 flex items-center justify-center">
                <Activity className="h-6 w-6 text-[#00E0AA]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Positions</p>
                <h3 className="text-2xl font-bold mt-2">{summary.active_positions}</h3>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <h3 className="text-2xl font-bold mt-2">
                  {summary.win_rate ? `${summary.win_rate.toFixed(1)}%` : 'N/A'}
                </h3>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <ArrowUpRight className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total P&L</p>
                <h3 className={`text-2xl font-bold mt-2 ${
                  summary.total_pnl_usd >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  ${summary.total_pnl_usd.toFixed(2)}
                </h3>
              </div>
              <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                summary.total_pnl_usd >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
              }`}>
                {summary.total_pnl_usd >= 0 ? (
                  <ArrowUpRight className="h-6 w-6 text-green-500" />
                ) : (
                  <ArrowDownRight className="h-6 w-6 text-red-500" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Latency</p>
                <h3 className="text-2xl font-bold mt-2">
                  {summary.avg_latency_seconds ? `${summary.avg_latency_seconds.toFixed(1)}s` : 'N/A'}
                </h3>
              </div>
              <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <CardHeader>
          <CardTitle>Copy Trading Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="trades" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="trades">Recent Trades</TabsTrigger>
              <TabsTrigger value="wallets">Tracked Wallets</TabsTrigger>
            </TabsList>

            <TabsContent value="trades" className="space-y-4 mt-4">
              {recent_trades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No copy trades yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b dark:border-gray-800">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                          Wallet
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                          Side
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          Price
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          Amount
                        </th>
                        <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          P&L
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                          Latency
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent_trades.map((trade) => {
                        const pnl = trade.status === 'closed'
                          ? trade.realized_pnl_usd
                          : trade.unrealized_pnl_usd

                        return (
                          <tr key={trade.id} className="border-b dark:border-gray-800">
                            <td className="py-3 px-4 text-sm">
                              <code className="text-xs">
                                {trade.source_wallet.slice(0, 6)}...{trade.source_wallet.slice(-4)}
                              </code>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={trade.side === 'YES' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {trade.side}
                              </Badge>
                            </td>
                            <td className="text-right py-3 px-4 text-sm">
                              {trade.our_entry_price.toFixed(3)}
                            </td>
                            <td className="text-right py-3 px-4 text-sm">
                              ${trade.our_usd_amount.toFixed(2)}
                            </td>
                            <td className="text-center py-3 px-4">
                              <Badge
                                variant={trade.status === 'open' ? 'outline' : 'secondary'}
                                className="text-xs"
                              >
                                {trade.status}
                              </Badge>
                            </td>
                            <td className={`text-right py-3 px-4 text-sm font-medium ${
                              pnl && pnl > 0 ? 'text-green-500' :
                              pnl && pnl < 0 ? 'text-red-500' : ''
                            }`}>
                              {pnl ? `$${pnl.toFixed(2)}` : '-'}
                            </td>
                            <td className="text-right py-3 px-4 text-sm text-muted-foreground">
                              {trade.latency_seconds.toFixed(1)}s
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="wallets" className="space-y-4 mt-4">
              {tracked_wallets.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No wallets tracked yet
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tracked_wallets.map((wallet) => (
                    <Card key={wallet.id} className="border dark:border-gray-800">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-[#00E0AA]" />
                            <code className="text-sm">
                              {wallet.wallet_address.slice(0, 6)}...{wallet.wallet_address.slice(-4)}
                            </code>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {wallet.status}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">Copied</p>
                            <p className="font-medium">{wallet.trades_copied}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Skipped</p>
                            <p className="font-medium">{wallet.trades_skipped}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">P&L</p>
                            <p className={`font-medium ${
                              wallet.cumulative_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              ${wallet.cumulative_pnl.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Omega</p>
                            <p className="font-medium">
                              {wallet.current_omega ? wallet.current_omega.toFixed(2) : 'N/A'}
                            </p>
                          </div>
                        </div>

                        {wallet.primary_category && (
                          <div className="mt-3 pt-3 border-t dark:border-gray-800">
                            <p className="text-xs text-muted-foreground">
                              Specializes in: <span className="text-foreground font-medium">{wallet.primary_category}</span>
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
