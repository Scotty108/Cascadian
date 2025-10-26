/**
 * Top Wallets Table Component
 *
 * Sortable table of top-performing wallets with Tier 1 metrics
 * Features: sorting, time window filtering, pagination
 */

"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTopWallets, type TimeWindow, type SortMetric } from "@/hooks/use-top-wallets"
import { ArrowUpDown, ArrowUp, ArrowDown, Copy, ExternalLink, Trophy } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface TopWalletsTableProps {
  defaultWindow?: TimeWindow
  defaultLimit?: number
  showPagination?: boolean
  compact?: boolean
}

export function TopWalletsTable({
  defaultWindow = 'lifetime',
  defaultLimit = 50,
  showPagination = true,
  compact = false
}: TopWalletsTableProps) {
  const [window, setWindow] = useState<TimeWindow>(defaultWindow)
  const [sortBy, setSortBy] = useState<SortMetric>('omega')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const limit = defaultLimit
  const { toast } = useToast()

  const { data: wallets, total, isLoading } = useTopWallets({
    window,
    sortBy,
    sortOrder,
    limit,
    offset: page * limit,
    minTrades: 10,
  })

  const handleSort = (metric: SortMetric) => {
    if (sortBy === metric) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(metric)
      setSortOrder('desc')
    }
    setPage(0) // Reset to first page on sort change
  }

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address)
    toast({
      title: "Address copied",
      description: "Wallet address copied to clipboard",
    })
  }

  const getOmegaGrade = (omega: number): { grade: string; color: string } => {
    if (omega >= 3.0) return { grade: 'S', color: 'bg-purple-500 text-white' }
    if (omega >= 2.0) return { grade: 'A', color: 'bg-[#00E0AA] text-black' }
    if (omega >= 1.5) return { grade: 'B', color: 'bg-blue-500 text-white' }
    if (omega >= 1.0) return { grade: 'C', color: 'bg-yellow-500 text-black' }
    if (omega >= 0.5) return { grade: 'D', color: 'bg-orange-500 text-white' }
    return { grade: 'F', color: 'bg-red-500 text-white' }
  }

  const SortIcon = ({ metric }: { metric: SortMetric }) => {
    if (sortBy !== metric) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-30" />
    }
    return sortOrder === 'desc' ? (
      <ArrowDown className="h-4 w-4 ml-1" />
    ) : (
      <ArrowUp className="h-4 w-4 ml-1" />
    )
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              Top Performing Wallets
            </CardTitle>
            <CardDescription className="mt-1">
              Elite traders ranked by Tier 1 metrics • {total.toLocaleString()} total wallets
            </CardDescription>
          </div>

          {/* Time Window Filter */}
          <Select value={window} onValueChange={(val) => {
            setWindow(val as TimeWindow)
            setPage(0)
          }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="180d">Last 180 Days</SelectItem>
              <SelectItem value="lifetime">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse text-muted-foreground">Loading top wallets...</div>
          </div>
        ) : wallets.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">No wallets found</div>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="min-w-[300px]">Wallet</TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 font-medium"
                        onClick={() => handleSort('omega')}
                      >
                        Omega
                        <SortIcon metric="omega" />
                      </Button>
                    </TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 font-medium"
                        onClick={() => handleSort('pnl')}
                      >
                        Net P&L
                        <SortIcon metric="pnl" />
                      </Button>
                    </TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 font-medium"
                        onClick={() => handleSort('win_rate')}
                      >
                        Win Rate
                        <SortIcon metric="win_rate" />
                      </Button>
                    </TableHead>
                    {!compact && (
                      <>
                        <TableHead>Avg Win</TableHead>
                        <TableHead>Avg Loss</TableHead>
                        <TableHead>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 font-medium"
                            onClick={() => handleSort('ev_per_bet')}
                          >
                            EV/Bet
                            <SortIcon metric="ev_per_bet" />
                          </Button>
                        </TableHead>
                      </>
                    )}
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 font-medium"
                        onClick={() => handleSort('resolved_bets')}
                      >
                        Trades
                        <SortIcon metric="resolved_bets" />
                      </Button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map((wallet, index) => {
                    const rank = page * limit + index + 1
                    const omegaInfo = getOmegaGrade(wallet.omega_net)
                    const shortAddress = `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`

                    return (
                      <TableRow key={wallet.wallet_address}>
                        <TableCell className="font-medium">
                          {rank <= 3 ? (
                            <span className="text-lg">{['🥇', '🥈', '🥉'][rank - 1]}</span>
                          ) : (
                            rank
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge className={`${omegaInfo.color} font-bold`}>
                              {omegaInfo.grade}
                            </Badge>
                            <code className="text-sm font-mono">{shortAddress}</code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => copyAddress(wallet.wallet_address)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => window.open(`/wallets/${wallet.wallet_address}`, '_blank')}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold">{wallet.omega_net.toFixed(2)}</span>
                        </TableCell>
                        <TableCell>
                          <span className={wallet.net_pnl_usd >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                            {formatCurrency(wallet.net_pnl_usd)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{formatPercent(wallet.hit_rate)}</span>
                        </TableCell>
                        {!compact && (
                          <>
                            <TableCell className="text-green-600">
                              {formatCurrency(wallet.avg_win_usd)}
                            </TableCell>
                            <TableCell className="text-red-600">
                              {formatCurrency(wallet.avg_loss_usd)}
                            </TableCell>
                            <TableCell>
                              <span className={wallet.ev_per_bet_mean >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                {formatCurrency(wallet.ev_per_bet_mean)}
                              </span>
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-muted-foreground">
                          {wallet.resolved_bets.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {showPagination && totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total.toLocaleString()} wallets
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
