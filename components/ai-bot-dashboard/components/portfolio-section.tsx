"use client"

import { RefreshCw, Download, Eye, Settings, History, Trash, MoreHorizontal } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatCurrency, formatPercentage } from "../utils"
import { cn } from "@/lib/utils"
import type { BotData, Asset } from "../types"

interface PortfolioSectionProps {
  botData: BotData
  onAssetAction: (asset: Asset, action: string) => void
}

export function PortfolioSection({ botData, onAssetAction }: PortfolioSectionProps) {
  return (
    <>
      {/* Portfolio allocation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Portfolio Allocation</CardTitle>
          <CardDescription>Current asset distribution managed by the AI</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 flex items-center justify-center">
            <div className="h-[250px] w-[250px] rounded-full border-8 border-background bg-muted flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">{formatCurrency(botData.balance)}</p>
              </div>
            </div>
          </div>
          <div className="flex-1">
            <div className="space-y-4">
              {botData.assets.map((asset) => (
                <div key={asset.symbol} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{asset.symbol}</div>
                    <div className="text-sm">{asset.allocation}%</div>
                  </div>
                  <Progress value={asset.allocation} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div>{formatCurrency(asset.price)}</div>
                    <div
                      className={cn(
                        asset.change24h >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {formatPercentage(asset.change24h)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t pt-4 flex justify-between">
          <Button variant="outline" size="sm" className="gap-1">
            <RefreshCw className="h-4 w-4" />
            <span>Rebalance</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-1">
            <Download className="h-4 w-4" />
            <span>Export</span>
          </Button>
        </CardFooter>
      </Card>

      {/* Performance metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Portfolio Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Daily</span>
                <span
                  className={cn(
                    "font-medium",
                    botData.profit.daily >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatPercentage(botData.profit.daily)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Weekly</span>
                <span
                  className={cn(
                    "font-medium",
                    botData.profit.weekly >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatPercentage(botData.profit.weekly)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monthly</span>
                <span
                  className={cn(
                    "font-medium",
                    botData.profit.monthly >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatPercentage(botData.profit.monthly)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <span
                  className={cn(
                    "font-medium",
                    botData.profit.total >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatPercentage(botData.profit.total)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Trading Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Trades</span>
                <span className="font-medium">{botData.trades.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Successful</span>
                <span className="font-medium text-green-600 dark:text-green-400">{botData.trades.successful}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Failed</span>
                <span className="font-medium text-red-600 dark:text-red-400">{botData.trades.failed}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Win Rate</span>
                <span className="font-medium">{botData.trades.winRate}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Market Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Market Trend</span>
                <Badge
                  variant={
                    botData.marketConditions.overall === "bullish"
                      ? "default"
                      : botData.marketConditions.overall === "bearish"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {botData.marketConditions.overall}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Volatility</span>
                <span className="font-medium capitalize">{botData.marketConditions.volatility}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Volume</span>
                <span className="font-medium capitalize">{botData.marketConditions.volume}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Sentiment</span>
                <span className="font-medium capitalize">{botData.marketConditions.sentiment}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Asset table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Asset Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>24h Change</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {botData.assets.map((asset) => (
                <TableRow key={asset.symbol}>
                  <TableCell className="font-medium">{asset.symbol}</TableCell>
                  <TableCell>{formatCurrency(asset.price)}</TableCell>
                  <TableCell
                    className={cn(
                      asset.change24h >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {formatPercentage(asset.change24h)}
                  </TableCell>
                  <TableCell>{asset.allocation}%</TableCell>
                  <TableCell>{formatCurrency((asset.allocation / 100) * botData.balance)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onAssetAction(asset, "details")}>
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onAssetAction(asset, "adjust")}>
                          <Settings className="mr-2 h-4 w-4" />
                          Adjust Allocation
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onAssetAction(asset, "history")}>
                          <History className="mr-2 h-4 w-4" />
                          Trade History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600 dark:text-red-400"
                          onClick={() => onAssetAction(asset, "remove")}
                        >
                          <Trash className="mr-2 h-4 w-4" />
                          Remove from Portfolio
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
