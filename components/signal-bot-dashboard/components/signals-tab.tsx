"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertCircle, Copy, ExternalLink, Filter, Search, Trash, TrendingDown, TrendingUp } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface Signal {
  id: string
  provider: string
  symbol: string
  type: "BUY" | "SELL"
  price: number
  confidence: number
  timestamp: string
  status: "active" | "executed" | "expired" | "stopped"
  pnl?: number
  volume?: number
  description?: string
  stopLoss?: number
  takeProfit?: number
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
}

const mockSignals: Signal[] = [
  {
    id: "SIG001",
    provider: "CryptoSignals Pro",
    symbol: "BTC/USDT",
    type: "BUY",
    price: 43250.0,
    confidence: 85,
    timestamp: "2024-01-15 14:30:00",
    status: "active",
    volume: 1.5,
    description: "Strong bullish momentum with RSI oversold conditions",
    stopLoss: 42000,
    takeProfit: 45000,
    riskLevel: "MEDIUM",
  },
  {
    id: "SIG002",
    provider: "AI Trading Signals",
    symbol: "ETH/USDT",
    type: "SELL",
    price: 2580.5,
    confidence: 92,
    timestamp: "2024-01-15 14:25:00",
    status: "executed",
    pnl: 125.3,
    volume: 5.2,
    description: "Bearish divergence detected on 4H chart",
    stopLoss: 2650,
    takeProfit: 2450,
    riskLevel: "LOW",
  },
  {
    id: "SIG003",
    provider: "TechAnalysis Bot",
    symbol: "ADA/USDT",
    type: "BUY",
    price: 0.485,
    confidence: 78,
    timestamp: "2024-01-15 14:20:00",
    status: "expired",
    volume: 1000,
    description: "Support level bounce with volume confirmation",
    stopLoss: 0.465,
    takeProfit: 0.52,
    riskLevel: "HIGH",
  },
  {
    id: "SIG004",
    provider: "Market Maker Pro",
    symbol: "SOL/USDT",
    type: "BUY",
    price: 98.75,
    confidence: 88,
    timestamp: "2024-01-15 14:15:00",
    status: "active",
    volume: 10.5,
    description: "Breakout above resistance with high volume",
    stopLoss: 95.0,
    takeProfit: 105.0,
    riskLevel: "MEDIUM",
  },
  {
    id: "SIG005",
    provider: "Whale Tracker",
    symbol: "MATIC/USDT",
    type: "SELL",
    price: 0.825,
    confidence: 75,
    timestamp: "2024-01-15 14:10:00",
    status: "stopped",
    pnl: -45.2,
    volume: 2500,
    description: "Large whale movements detected",
    stopLoss: 0.85,
    takeProfit: 0.78,
    riskLevel: "HIGH",
  },
]

export function SignalsTab() {
  const [signals] = useState<Signal[]>(mockSignals)
  const [filteredSignals, setFilteredSignals] = useState<Signal[]>(mockSignals)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null)
  const [detailsModalOpen, setDetailsModalOpen] = useState(false)
  const { toast } = useToast()

  // Filter signals based on search and filters
  const handleFilter = () => {
    let filtered = signals

    if (searchTerm) {
      filtered = filtered.filter(
        (signal) =>
          signal.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
          signal.provider.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((signal) => signal.status === statusFilter)
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((signal) => signal.type === typeFilter)
    }

    setFilteredSignals(filtered)
  }

  // Handle copy signal
  const handleCopySignal = (signal: Signal) => {
    const signalText = `Signal: ${signal.symbol} ${signal.type} at ${signal.price}
Provider: ${signal.provider}
Confidence: ${signal.confidence}%
Stop Loss: ${signal.stopLoss}
Take Profit: ${signal.takeProfit}
Description: ${signal.description}`

    navigator.clipboard
      .writeText(signalText)
      .then(() => {
        toast({
          title: "Signal Copied",
          description: "Signal details have been copied to clipboard",
        })
      })
      .catch(() => {
        toast({
          title: "Copy Failed",
          description: "Failed to copy signal to clipboard",
          variant: "destructive",
        })
      })
  }

  // Handle stop signal
  const handleStopSignal = (signal: Signal) => {
    toast({
      title: "Signal Stopped",
      description: `Signal ${signal.id} for ${signal.symbol} has been stopped`,
    })
    // In a real app, you would update the signal status in your state/database
  }

  // Handle view details
  const handleViewDetails = (signal: Signal) => {
    setSelectedSignal(signal)
    setDetailsModalOpen(true)
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      active: "default",
      executed: "secondary",
      expired: "outline",
      stopped: "destructive",
    } as const

    return <Badge variant={variants[status as keyof typeof variants] || "outline"}>{status.toUpperCase()}</Badge>
  }

  const getTypeBadge = (type: string) => {
    return (
      <Badge variant={type === "BUY" ? "default" : "destructive"}>
        {type === "BUY" ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
        {type}
      </Badge>
    )
  }

  const getRiskBadge = (risk: string) => {
    const variants = {
      LOW: "secondary",
      MEDIUM: "default",
      HIGH: "destructive",
    } as const

    return <Badge variant={variants[risk as keyof typeof variants] || "outline"}>{risk}</Badge>
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Signal Filters
          </CardTitle>
          <CardDescription>Filter and search through trading signals</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search symbols or providers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="executed">Executed</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="stopped">Stopped</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="BUY">Buy Signals</SelectItem>
                  <SelectItem value="SELL">Sell Signals</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleFilter} className="w-full">
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signals Table */}
      <Card>
        <CardHeader>
          <CardTitle>Trading Signals</CardTitle>
          <CardDescription>Recent trading signals from connected providers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSignals.map((signal) => (
                  <TableRow key={signal.id}>
                    <TableCell className="font-medium">{signal.provider}</TableCell>
                    <TableCell>{signal.symbol}</TableCell>
                    <TableCell>{getTypeBadge(signal.type)}</TableCell>
                    <TableCell>${signal.price.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-12 bg-secondary rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: `${signal.confidence}%` }} />
                        </div>
                        <span className="text-sm">{signal.confidence}%</span>
                      </div>
                    </TableCell>
                    <TableCell>{getRiskBadge(signal.riskLevel)}</TableCell>
                    <TableCell>{getStatusBadge(signal.status)}</TableCell>
                    <TableCell>
                      {signal.pnl ? (
                        <span className={signal.pnl > 0 ? "text-green-600" : "text-red-600"}>
                          {signal.pnl > 0 ? "+" : ""}${signal.pnl.toFixed(2)}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{signal.timestamp}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleViewDetails(signal)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>View Details</span>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleCopySignal(signal)}>
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          <span>Copy</span>
                        </Button>
                        {signal.status === "active" && (
                          <Button variant="destructive" size="sm" onClick={() => handleStopSignal(signal)}>
                            <Trash className="mr-1 h-3.5 w-3.5" />
                            <span>Stop</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Signal Details Modal */}
      <Dialog open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Signal Details</DialogTitle>
            <DialogDescription>Detailed information about the trading signal</DialogDescription>
          </DialogHeader>

          {selectedSignal && (
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Signal ID</Label>
                  <p className="text-sm text-muted-foreground">{selectedSignal.id}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Provider</Label>
                  <p className="text-sm text-muted-foreground">{selectedSignal.provider}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Symbol</Label>
                  <p className="text-sm text-muted-foreground">{selectedSignal.symbol}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Type</Label>
                  <div className="mt-1">{getTypeBadge(selectedSignal.type)}</div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Entry Price</Label>
                  <p className="text-sm text-muted-foreground">${selectedSignal.price.toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Confidence</Label>
                  <p className="text-sm text-muted-foreground">{selectedSignal.confidence}%</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Stop Loss</Label>
                  <p className="text-sm text-muted-foreground">${selectedSignal.stopLoss?.toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Take Profit</Label>
                  <p className="text-sm text-muted-foreground">${selectedSignal.takeProfit?.toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Volume</Label>
                  <p className="text-sm text-muted-foreground">{selectedSignal.volume}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Risk Level</Label>
                  <div className="mt-1">{getRiskBadge(selectedSignal.riskLevel)}</div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Status</Label>
                  <div className="mt-1">{getStatusBadge(selectedSignal.status)}</div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Timestamp</Label>
                  <p className="text-sm text-muted-foreground">{selectedSignal.timestamp}</p>
                </div>
              </div>

              {/* Description */}
              {selectedSignal.description && (
                <div>
                  <Label className="text-sm font-medium">Analysis</Label>
                  <p className="text-sm text-muted-foreground mt-1">{selectedSignal.description}</p>
                </div>
              )}

              {/* P&L if available */}
              {selectedSignal.pnl && (
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <Label className="text-sm font-medium">Performance</Label>
                  </div>
                  <p
                    className={`text-lg font-semibold mt-1 ${selectedSignal.pnl > 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {selectedSignal.pnl > 0 ? "+" : ""}${selectedSignal.pnl.toFixed(2)}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end flex-wrap gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => handleCopySignal(selectedSignal)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Signal
                </Button>
                {selectedSignal.status === "active" && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      handleStopSignal(selectedSignal)
                      setDetailsModalOpen(false)
                    }}
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Stop Signal
                  </Button>
                )}
                <Button onClick={() => setDetailsModalOpen(false)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
