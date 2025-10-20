"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowDownUp, ArrowRight, Clock, Coins } from "lucide-react"

interface Trade {
  id: string
  timestamp: Date
  buyExchange: string
  sellExchange: string
  pair: string
  volume: number
  spread: number
  profit: number
  status: string
  executionTime?: number
}

interface TradesTabProps {
  trades: Trade[]
}

export function TradesTab({ trades }: TradesTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
          <CardDescription>Latest arbitrage trades executed by this bot</CardDescription>
        </CardHeader>
        <CardContent>
          {trades.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Pair</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Spread</TableHead>
                  <TableHead>Profit</TableHead>
                  <TableHead>Execution</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell>
                      {trade.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="font-medium">{trade.pair}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="text-sm">{trade.buyExchange}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="text-sm">{trade.sellExchange}</span>
                      </div>
                    </TableCell>
                    <TableCell>${trade.volume.toLocaleString()}</TableCell>
                    <TableCell>{trade.spread}%</TableCell>
                    <TableCell className="font-medium text-green-600 dark:text-green-400">
                      ${trade.profit.toFixed(2)}
                    </TableCell>
                    <TableCell>{trade.executionTime}s</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          trade.status === "completed"
                            ? "default"
                            : trade.status === "pending"
                              ? "outline"
                              : "secondary"
                        }
                      >
                        {trade.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ArrowDownUp className="mb-2 h-10 w-10 text-muted-foreground" />
              <h3 className="text-lg font-medium">No trades yet</h3>
              <p className="text-sm text-muted-foreground">This bot hasn&apos;t executed any trades yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{trades.length}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">
                ${trades.reduce((sum, trade) => sum + trade.volume, 0).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg. Execution Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">
                {trades.length > 0
                  ? (trades.reduce((sum, trade) => sum + (trade.executionTime || 0), 0) / trades.length).toFixed(1) +
                    "s"
                  : "0.0s"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
