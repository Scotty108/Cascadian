"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Search, Filter, Download, Calendar, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown } from "lucide-react"
import type { DcaBot } from "../types"
import { formatCurrency, formatDateTime, getProfitColor } from "../utils"

interface HistoryTabProps {
  bots: DcaBot[]
}

export function HistoryTab({ bots }: HistoryTabProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [botFilter, setBotFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<string>("date")

  // Flatten all purchase history from all bots
  const allPurchases = bots.flatMap((bot) =>
    bot.history.map((purchase) => ({
      ...purchase,
      botName: bot.name,
      botId: bot.id,
      asset: bot.asset,
      exchange: bot.exchange,
    })),
  )

  const filteredPurchases = allPurchases
    .filter((purchase) => {
      const matchesSearch =
        purchase.botName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        purchase.asset.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesBot = botFilter === "all" || purchase.botId === botFilter
      const matchesStatus = statusFilter === "all" || purchase.status === statusFilter
      return matchesSearch && matchesBot && matchesStatus
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "bot":
          return a.botName.localeCompare(b.botName)
        case "amount":
          return b.amount - a.amount
        case "profit":
          return b.value - b.amount - (a.value - a.amount)
        case "date":
        default:
          return new Date(b.date).getTime() - new Date(a.date).getTime()
      }
    })

  const totalPurchases = filteredPurchases.length
  const completedPurchases = filteredPurchases.filter((p) => p.status === "completed").length
  const failedPurchases = filteredPurchases.filter((p) => p.status === "failed").length
  const totalInvested = filteredPurchases.reduce((sum, p) => sum + p.amount, 0)
  const totalValue = filteredPurchases.reduce((sum, p) => sum + p.value, 0)
  const totalProfit = totalValue - totalInvested

  const handleExport = () => {
    const csvContent = [
      ["Date", "Bot Name", "Asset", "Exchange", "Amount", "Price", "Value", "Profit/Loss", "Status"],
      ...filteredPurchases.map((purchase) => [
        formatDateTime(purchase.date),
        purchase.botName,
        purchase.asset,
        purchase.exchange,
        purchase.amount.toString(),
        purchase.price.toString(),
        purchase.value.toString(),
        (purchase.value - purchase.amount).toString(),
        purchase.status,
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n")

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `dca-purchase-history-${new Date().toISOString().split("T")[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />
      default:
        return null
    }
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "default"
      case "failed":
        return "destructive"
      case "pending":
        return "secondary"
      default:
        return "outline"
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Purchases</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPurchases}</div>
            <p className="text-xs text-muted-foreground">
              {completedPurchases} completed, {failedPurchases} failed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invested</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalInvested)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Profit</CardTitle>
            {totalProfit >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getProfitColor(totalProfit)}`}>{formatCurrency(totalProfit)}</div>
            <p className={`text-xs ${getProfitColor(totalProfit)}`}>
              {totalInvested > 0 ? `${((totalProfit / totalInvested) * 100).toFixed(2)}%` : "0%"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filter & Search
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search by bot name or asset..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={botFilter} onValueChange={setBotFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by bot" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Bots</SelectItem>
                {bots.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>
                    {bot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="bot">Bot Name</SelectItem>
                <SelectItem value="amount">Amount</SelectItem>
                <SelectItem value="profit">Profit/Loss</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {searchTerm || botFilter !== "all" || statusFilter !== "all" ? (
        <Alert>
          <AlertDescription>
            Showing {filteredPurchases.length} of {allPurchases.length} purchases
            {searchTerm && ` matching "${searchTerm}"`}
            {botFilter !== "all" && ` from selected bot`}
            {statusFilter !== "all" && ` with status "${statusFilter}"`}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Purchase History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Purchase History</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredPurchases.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No purchase history found</p>
              <p className="text-sm mt-2">
                {allPurchases.length === 0 ? "No purchases have been made yet" : "Try adjusting your filters"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Bot</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Exchange</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Profit/Loss</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPurchases.map((purchase, index) => {
                    const profit = purchase.value - purchase.amount
                    return (
                      <TableRow key={`${purchase.botId}-${index}`}>
                        <TableCell className="font-medium">{formatDateTime(purchase.date)}</TableCell>
                        <TableCell>{purchase.botName}</TableCell>
                        <TableCell>{purchase.asset}</TableCell>
                        <TableCell>{purchase.exchange}</TableCell>
                        <TableCell className="text-right">{formatCurrency(purchase.amount)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(purchase.price)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(purchase.value)}</TableCell>
                        <TableCell className={`text-right ${getProfitColor(profit)}`}>
                          {formatCurrency(profit)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(purchase.status)}>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(purchase.status)}
                              {purchase.status}
                            </div>
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
