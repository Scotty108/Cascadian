"use client"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Play, Pause, X, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ArbitrageBot } from "../types"

interface BotCardProps {
  bot: ArbitrageBot
  onPause?: (botId: string) => void
  onResume?: (botId: string) => void
}

export function BotCard({ bot, onPause, onResume }: BotCardProps) {
  return (
    <Card
      className={cn(
        "transition-all hover:shadow-md",
        bot.status === "active" && "border-green-200 dark:border-green-900",
        bot.status === "paused" && "border-yellow-200 dark:border-yellow-900",
        bot.status === "stopped" && "border-red-200 dark:border-red-900",
      )}
    >
      <CardHeader className="p-4 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{bot.name}</CardTitle>
          <Badge
            variant={bot.status === "active" ? "default" : bot.status === "paused" ? "outline" : "secondary"}
            className="px-2 py-0"
          >
            {bot.status === "active" ? (
              <Play className="mr-1 h-3 w-3" />
            ) : bot.status === "paused" ? (
              <Pause className="mr-1 h-3 w-3" />
            ) : (
              <X className="mr-1 h-3 w-3" />
            )}
            {bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">Exchanges</div>
            <div className="font-medium">{bot.exchanges.length} Connected</div>
          </div>
          <div>
            <div className="text-muted-foreground">Trading Pairs</div>
            <div className="font-medium">{bot.pairs.length} Pairs</div>
          </div>
          <div>
            <div className="text-muted-foreground">Min Spread</div>
            <div className="font-medium">{bot.minSpread}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Profit Threshold</div>
            <div className="font-medium">${bot.profitThreshold}</div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="text-muted-foreground">Success Rate</div>
            <div className="font-medium">{bot.successRate}%</div>
          </div>
          <Progress value={bot.successRate} className="h-1" />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">Total Profit</div>
          <div className="text-sm font-bold text-green-600 dark:text-green-400">+${bot.totalProfit.toFixed(2)}</div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between p-4 pt-0">
        {bot.status === "active" ? (
          <Button size="sm" variant="outline" className="w-full" onClick={() => onPause?.(bot.id)}>
            <Pause className="mr-1 h-3 w-3" />
            Pause
          </Button>
        ) : bot.status === "paused" ? (
          <Button size="sm" variant="default" className="w-full" onClick={() => onResume?.(bot.id)}>
            <Play className="mr-1 h-3 w-3" />
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="default" className="w-full" onClick={() => onResume?.(bot.id)}>
            <Play className="mr-1 h-3 w-3" />
            Start
          </Button>
        )}
        <Button size="sm" variant="outline" className="w-full">
          <Settings className="mr-1 h-3 w-3" />
          Configure
        </Button>
      </CardFooter>
    </Card>
  )
}
