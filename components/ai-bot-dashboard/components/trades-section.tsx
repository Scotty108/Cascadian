"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Search,
  Download,
  Eye,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  MoreHorizontal,
} from "lucide-react"
import type { BotData, Trade } from "../types"
import { formatCurrency, formatPercentage, formatDate } from "../utils"

interface TradesSectionProps {
  botData: BotData
}

export function TradesSection({ botData }: TradesSectionProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)
  const [showTradeDetails, setShowTradeDetails] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter trades based on search and filters
  const filteredTrades = botData.recentTrades.filter((trade: Trade) => {
    const matchesSearch =
      trade.pair.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.id.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || trade.status === statusFilter
    const matchesType = typeFilter === "all" || trade.type === typeFilter

    return matchesSearch && matchesStatus && matchesType
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-600" />
      case "cancelled":
        return <XCircle className="w-4 h-4 text-gray-600" />
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-600" />
      default:
        return <Clock className="w-4 h-4 text-gray-600" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      completed: "bg-green-100 text-green-700",
      pending: "bg-yellow-100 text-yellow-700",
      cancelled: "bg-gray-100 text-gray-700",
      failed: "bg-red-100 text-red-700",
    }

    return (
      <Badge className={variants[status as keyof typeof variants] || variants.pending}>
        {getStatusIcon(status)}
        <span className="ml-1 capitalize">{status}</span>
      </Badge>
    )
  }

  const getTypeIcon = (type: string) => {
    return type === "buy" ? (
      <TrendingUp className="w-4 h-4 text-green-600" />
    ) : (
      <TrendingDown className="w-4 h-4 text-red-600" />
    )
  }

  const handleTradeDetails = (trade: Trade) => {
    setSelectedTrade(trade)
    setShowTradeDetails(true)
  }

  const handleExportTrades = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Simulate an API call or some async operation
      await new Promise((resolve) => setTimeout(resolve, 1000))
      console.log("Exporting trades...")
    } catch (e: any) {
      setError(e.message || "Failed to export trades.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Trade Statistics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{botData.trades.total}</div>
            <p className="text-xs text-muted-foreground">+12 from yesterday</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Successful</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{botData.trades.successful}</div>
            <p className="text-xs text-muted-foreground">{formatPercentage(botData.trades.winRate)} win rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{botData.trades.failed}</div>
            <p className="text-xs text-muted-foreground">
              {formatPercentage((botData.trades.failed / botData.trades.total) * 100)} failure rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">$45.20</div>
            <p className="text-xs text-muted-foreground">Per successful trade</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="recent" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recent">Recent Trades</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Recent Trades Tab */}
        <TabsContent value="recent" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Search</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search trades..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="buy">Buy</SelectItem>
                      <SelectItem value="sell">Sell</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Actions</Label>
                  <Button onClick={handleExportTrades} disabled={isLoading} className="w-full">
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                  {isLoading && <p>Loading...</p>}
                  {error && <p className="text-red-500">{error}</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trades Table */}
          <Card>
            <CardHeader>
              <CardTitle>Trade History</CardTitle>
              <CardDescription>Recent trading activity and performance</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Pair</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Profit/Loss</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTrades.length > 0 ? (
                    filteredTrades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="font-mono text-sm">{formatDate(trade.time)}</TableCell>
                        <TableCell className="font-medium">{trade.pair}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-1">
                            {getTypeIcon(trade.type)}
                            <span className="capitalize">{trade.type}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{formatCurrency(trade.price)}</TableCell>
                        <TableCell className="font-mono">{trade.amount.toFixed(6)}</TableCell>
                        <TableCell>{getStatusBadge(trade.status)}</TableCell>
                        <TableCell>
                          <span className={trade.profit >= 0 ? "text-green-600" : "text-red-600"}>
                            {trade.profit >= 0 ? "+" : ""}
                            {formatCurrency(trade.profit)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => handleTradeDetails(trade)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center">
                        No trades found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm">Total Volume</span>
                    <span className="font-medium">{formatCurrency(125000)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Average Trade Size</span>
                    <span className="font-medium">{formatCurrency(850)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Best Trade</span>
                    <span className="font-medium text-green-600">+{formatCurrency(245)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Worst Trade</span>
                    <span className="font-medium text-red-600">-{formatCurrency(89)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Avg Hold Time</span>
                    <span className="font-medium">2h 15m</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Trading Pairs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {["BTC/USDT", "ETH/USDT", "BNB/USDT", "ADA/USDT"].map((pair) => (
                    <div key={pair} className="flex items-center justify-between p-2 border rounded">
                      <span className="font-medium">{pair}</span>
                      <div className="text-right">
                        <p className="text-sm font-medium text-green-600">+5.2%</p>
                        <p className="text-xs text-muted-foreground">24 trades</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Trade Details Modal */}
      <Dialog open={showTradeDetails} onOpenChange={setShowTradeDetails}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>Trade Details</DialogTitle>
            <DialogDescription>Detailed information about trade {selectedTrade?.id}</DialogDescription>
          </DialogHeader>
          {selectedTrade && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Trade ID</Label>
                  <p className="font-mono text-sm">{selectedTrade.id}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Status</Label>
                  <div className="mt-1">{getStatusBadge(selectedTrade.status)}</div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Pair</Label>
                  <p className="font-medium">{selectedTrade.pair}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Type</Label>
                  <div className="flex items-center space-x-1 mt-1">
                    {getTypeIcon(selectedTrade.type)}
                    <span className="capitalize">{selectedTrade.type}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Price</Label>
                  <p className="font-mono">{formatCurrency(selectedTrade.price)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Amount</Label>
                  <p className="font-mono">{selectedTrade.amount.toFixed(6)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Time</Label>
                  <p className="text-sm">{formatDate(selectedTrade.time)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Profit/Loss</Label>
                  <p className={selectedTrade.profit >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                    {selectedTrade.profit >= 0 ? "+" : ""}
                    {formatCurrency(selectedTrade.profit)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
