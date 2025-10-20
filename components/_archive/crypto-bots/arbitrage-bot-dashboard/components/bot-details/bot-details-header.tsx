"use client"

import { ArrowLeft, Clock, Coins, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import type { ArbitrageBot } from "../../types"

interface BotDetailsHeaderProps {
  bot: ArbitrageBot
  onBack: () => void
}

export function BotDetailsHeader({ bot, onBack }: BotDetailsHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">{bot.name}</h2>
        <Badge
          variant={bot.status === "active" ? "default" : bot.status === "paused" ? "outline" : "secondary"}
          className="ml-2"
        >
          {bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
        </Badge>
      </div>

      <p className="text-muted-foreground">{bot.description || "No description available"}</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Profit</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                ${bot.totalProfit?.toFixed(2) || "0.00"}
              </p>
            </div>
            <Coins className="h-8 w-8 text-green-600 dark:text-green-400" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Success Rate</p>
              <p className="text-2xl font-bold">{bot.successRate || 0}%</p>
            </div>
            <TrendingUp className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Trades</p>
              <p className="text-2xl font-bold">{bot.totalTrades || 0}</p>
            </div>
            <Clock className="h-8 w-8 text-purple-600 dark:text-purple-400" />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Exchanges:</span>
          <span className="font-medium">
            {bot.exchanges?.map((exchange) => exchange.charAt(0).toUpperCase() + exchange.slice(1)).join(", ") ||
              "None"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Pairs:</span>
          <span className="font-medium">{bot.pairs?.join(", ") || "None"}</span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Min Spread:</span>
          <span className="font-medium">{bot.minSpread}%</span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Created:</span>
          <span className="font-medium">{bot.createdAt?.toLocaleDateString() || new Date().toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  )
}
