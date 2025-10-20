"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Download, Search, ArrowUpDown } from "lucide-react"
import { formatCurrency } from "../../utils"
import type { Asset } from "../../types"

interface TradeHistoryModalProps {
  asset: Asset | null
  isOpen: boolean
  onClose: () => void
}

interface AssetTrade {
  id: string
  date: string
  type: "buy" | "sell"
  price: number
  amount: number
  value: number
  status: "completed" | "pending" | "cancelled" | "failed"
  exchange: string
  fee: number
  profit?: number
}

export function TradeHistoryModal({ asset, isOpen, onClose }: TradeHistoryModalProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<keyof AssetTrade>("date")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  if (!asset) return null

  // Mock trade history data
  const mockTradeHistory: AssetTrade[] = [
    {
      id: "tx-1234567",
      date: "2023-06-01T14:32:15",
      type: "buy",
      price: asset.price * 0.9,
      amount: 0.5,
      value: asset.price * 0.9 * 0.5,
      status: "completed",
      exchange: "Binance",
      fee: 0.001 * asset.price * 0.9 * 0.5,
    },
    {
      id: "tx-1234568",
      date: "2023-06-05T09:15:22",
      type: "sell",
      price: asset.price * 0.95,
      amount: 0.2,
      value: asset.price * 0.95 * 0.2,
      status: "completed",
      exchange: "Coinbase",
      fee: 0.001 * asset.price * 0.95 * 0.2,
      profit: 0.05 * asset.price * 0.2,
    },
    {
      id: "tx-1234569",
      date: "2023-06-10T16:45:30",
      type: "buy",
      price: asset.price * 0.85,
      amount: 0.75,
      value: asset.price * 0.85 * 0.75,
      status: "completed",
      exchange: "Kraken",
      fee: 0.001 * asset.price * 0.85 * 0.75,
    },
    {
      id: "tx-1234570",
      date: "2023-06-15T11:22:45",
      type: "sell",
      price: asset.price * 1.05,
      amount: 0.3,
      value: asset.price * 1.05 * 0.3,
      status: "completed",
      exchange: "Binance",
      fee: 0.001 * asset.price * 1.05 * 0.3,
      profit: 0.2 * asset.price * 0.3,
    },
    {
      id: "tx-1234571",
      date: "2023-06-20T08:10:15",
      type: "buy",
      price: asset.price * 0.92,
      amount: 0.4,
      value: asset.price * 0.92 * 0.4,
      status: "pending",
      exchange: "Coinbase",
      fee: 0.001 * asset.price * 0.92 * 0.4,
    },
    {
      id: "tx-1234572",
      date: "2023-06-25T13:05:30",
      type: "sell",
      price: asset.price * 0.88,
      amount: 0.15,
      value: asset.price * 0.88 * 0.15,
      status: "failed",
      exchange: "Kraken",
      fee: 0,
    },
  ]

  // Filter and sort trades
  const filteredTrades = mockTradeHistory
    .filter((trade) => {
      const matchesSearch =
        trade.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        trade.exchange.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === "all" || trade.status === statusFilter
      const matchesType = typeFilter === "all" || trade.type === typeFilter

      return matchesSearch && matchesStatus && matchesType
    })
    .sort((a, b) => {
      const aValue = a[sortField]
      const bValue = b[sortField]

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
      }

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue
      }

      return 0
    })

  const handleSort = (field: keyof AssetTrade) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString()
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "default"
      case "pending":
        return "secondary"
      case "cancelled":
        return "outline"
      case "failed":
        return "destructive"
      default:
        return "outline"
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trade History for {asset.symbol}</DialogTitle>
          <DialogDescription>View all trades for this asset</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID or exchange..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="buy">Buy</SelectItem>
                <SelectItem value="sell">Sell</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trade table */}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px] cursor-pointer" onClick={() => handleSort("date")}>
                    <div className="flex items-center">
                      Date
                      {sortField === "date" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("type")}>
                    <div className="flex items-center">
                      Type
                      {sortField === "type" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("price")}>
                    <div className="flex items-center">
                      Price
                      {sortField === "price" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("amount")}>
                    <div className="flex items-center">
                      Amount
                      {sortField === "amount" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("value")}>
                    <div className="flex items-center">
                      Value
                      {sortField === "value" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("exchange")}>
                    <div className="flex items-center">
                      Exchange
                      {sortField === "exchange" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => handleSort("status")}>
                    <div className="flex items-center">
                      Status
                      {sortField === "status" && (
                        <ArrowUpDown className={`ml-1 h-4 w-4 ${sortDirection === "asc" ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                      No trades found matching your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTrades.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell className="font-medium">{formatDate(trade.date)}</TableCell>
                      <TableCell>
                        <Badge variant={trade.type === "buy" ? "default" : "secondary"}>
                          {trade.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(trade.price)}</TableCell>
                      <TableCell>{trade.amount}</TableCell>
                      <TableCell>{formatCurrency(trade.value)}</TableCell>
                      <TableCell>{trade.exchange}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(trade.status)}>
                          {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Summary */}
          <div className="bg-muted p-4 rounded-md">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Trades</p>
                <p className="text-lg font-medium">{mockTradeHistory.length}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Buy Volume</p>
                <p className="text-lg font-medium">
                  {formatCurrency(
                    mockTradeHistory
                      .filter((t) => t.type === "buy" && t.status === "completed")
                      .reduce((sum, t) => sum + t.value, 0),
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Sell Volume</p>
                <p className="text-lg font-medium">
                  {formatCurrency(
                    mockTradeHistory
                      .filter((t) => t.type === "sell" && t.status === "completed")
                      .reduce((sum, t) => sum + t.value, 0),
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Profit</p>
                <p className="text-lg font-medium text-green-600">
                  {formatCurrency(
                    mockTradeHistory.filter((t) => t.profit !== undefined).reduce((sum, t) => sum + (t.profit || 0), 0),
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between items-center">
          <Button variant="outline" size="sm" className="gap-1">
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
