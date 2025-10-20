"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, ExternalLink, Heart, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Asset } from "../../types";
import { formatCurrency, formatPercentage, getChangeColor } from "../../utils";

interface AssetDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
}

// Mock data for charts and details
const mockPriceData = [
  { time: "00:00", price: 42500, volume: 1200000 },
  { time: "04:00", price: 42750, volume: 980000 },
  { time: "08:00", price: 42300, volume: 1500000 },
  { time: "12:00", price: 42900, volume: 2100000 },
  { time: "16:00", price: 42830, volume: 1800000 },
  { time: "20:00", price: 43100, volume: 1600000 },
];

const mockTransactions = [
  { date: "2024-01-15", type: "Buy", amount: 0.25, price: 43000, value: 10750 },
  { date: "2024-01-10", type: "Sell", amount: 0.1, price: 42500, value: 4250 },
  { date: "2024-01-05", type: "Buy", amount: 0.5, price: 41800, value: 20900 },
];

const mockNews = [
  {
    title: "Bitcoin ETF Approval Drives Market Optimism",
    source: "CryptoNews",
    time: "2 hours ago",
    sentiment: "positive",
  },
  {
    title: "Major Institution Adds BTC to Treasury",
    source: "BlockchainDaily",
    time: "5 hours ago",
    sentiment: "positive",
  },
  {
    title: "Regulatory Clarity Boosts Crypto Adoption",
    source: "FinanceToday",
    time: "1 day ago",
    sentiment: "neutral",
  },
];

export function AssetDetailsModal({ open, onOpenChange, asset }: AssetDetailsModalProps) {
  const [isFavorite, setIsFavorite] = useState(false);

  if (!asset) return null;

  const totalPnL = asset.value - asset.cost;
  const pnlPercentage = (totalPnL / asset.cost) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto ">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={asset.icon || "/placeholder.svg"} alt={asset.name} width={32} height={32} className="w-8 h-8 rounded-full" />
              <div>
                <DialogTitle className="flex items-center gap-2">
                  {asset.name} ({asset.symbol})<Badge variant="outline">{asset.chain}</Badge>
                </DialogTitle>
                <DialogDescription>
                  Current Price: ${formatCurrency(asset.price)}
                  <span className={getChangeColor(asset.pnl)}> ({formatPercentage(asset.pnl)})</span>
                </DialogDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsFavorite(!isFavorite)}>
              <Heart className={`h-4 w-4 ${isFavorite ? "fill-red-500 text-red-500" : ""}`} />
            </Button>
          </div>
        </DialogHeader>

        <div className="w-full">
          <Tabs defaultValue="overview" className="w-full">
            <div className="overflow-x-auto">
              <TabsList className="grid w-full min-w-[600px] grid-cols-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="chart">Price Chart</TabsTrigger>
                <TabsTrigger value="transactions">Transactions</TabsTrigger>
                <TabsTrigger value="news">News</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Holdings</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{asset.holdings.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">{asset.symbol}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Current Value</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${formatCurrency(asset.value)}</div>
                    <p className="text-xs text-muted-foreground">{asset.allocation}% of portfolio</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">P&L</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${getChangeColor(pnlPercentage)}`}>${formatCurrency(Math.abs(totalPnL))}</div>
                    <p className={`text-xs ${getChangeColor(pnlPercentage)}`}>{formatPercentage(pnlPercentage)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Asset Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Price</span>
                      <span>${formatCurrency(asset.price)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">24h Change</span>
                      <span className={getChangeColor(asset.pnl)}>{formatPercentage(asset.pnl)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Average Cost</span>
                      <span>${formatCurrency(asset.cost / asset.holdings)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Cost</span>
                      <span>${formatCurrency(asset.cost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Market Cap Rank</span>
                      <span>#{asset.id}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full" variant="outline">
                      <TrendingUp className="mr-2 h-4 w-4" />
                      Buy More
                    </Button>
                    <Button className="w-full" variant="outline">
                      <TrendingDown className="mr-2 h-4 w-4" />
                      Sell
                    </Button>
                    <Button className="w-full" variant="outline">
                      <DollarSign className="mr-2 h-4 w-4" />
                      Set Price Alert
                    </Button>
                    <Button className="w-full" variant="outline">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View on Explorer
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="chart" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Price Chart (24h)</CardTitle>
                  <CardDescription>Price and volume data for the last 24 hours</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mockPriceData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="price" stroke="#8884d8" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Volume Chart (24h)</CardTitle>
                  <CardDescription>Trading volume for the last 24 hours</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={mockPriceData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis />
                        <Tooltip />
                        <Area type="monotone" dataKey="volume" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transactions" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Transaction History</CardTitle>
                  <CardDescription>Your trading history for this asset</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mockTransactions.map((tx, index) => (
                        <TableRow key={index}>
                          <TableCell>{tx.date}</TableCell>
                          <TableCell>
                            <Badge variant={tx.type === "Buy" ? "default" : "secondary"}>{tx.type}</Badge>
                          </TableCell>
                          <TableCell>
                            {tx.amount} {asset.symbol}
                          </TableCell>
                          <TableCell>${formatCurrency(tx.price)}</TableCell>
                          <TableCell>${formatCurrency(tx.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="news" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Latest News</CardTitle>
                  <CardDescription>Recent news and updates related to {asset.name}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {mockNews.map((news, index) => (
                    <div key={index} className="flex items-start space-x-3 p-3 border rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium">{news.title}</h4>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-sm text-muted-foreground">{news.source}</span>
                          <span className="text-sm text-muted-foreground">•</span>
                          <span className="text-sm text-muted-foreground">{news.time}</span>
                          <Badge variant={news.sentiment === "positive" ? "default" : news.sentiment === "negative" ? "destructive" : "secondary"} className="text-xs">
                            {news.sentiment}
                          </Badge>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analysis" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Technical Indicators</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span>RSI (14)</span>
                      <span className="font-medium">65.4</span>
                    </div>
                    <div className="flex justify-between">
                      <span>MACD</span>
                      <span className="font-medium text-green-500">Bullish</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Moving Average (50)</span>
                      <span className="font-medium">${formatCurrency(42100)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Support Level</span>
                      <span className="font-medium">${formatCurrency(41500)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Resistance Level</span>
                      <span className="font-medium">${formatCurrency(44000)}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Risk Assessment</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span>Volatility (30d)</span>
                      <Badge variant="secondary">High</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Liquidity</span>
                      <Badge variant="default">Excellent</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Market Cap</span>
                      <span className="font-medium">$850B</span>
                    </div>
                    <div className="flex justify-between">
                      <span>24h Volume</span>
                      <span className="font-medium">$25B</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Risk Score</span>
                      <Badge variant="outline">6/10</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
