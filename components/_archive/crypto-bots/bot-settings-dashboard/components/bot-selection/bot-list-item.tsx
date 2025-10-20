"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ArrowRight, Cpu, RefreshCw, Zap } from "lucide-react"
import type { BotConfig } from "../../types"
import { getStatusColor, getBotTypeColor } from "../../utils"

interface BotListItemProps {
  bot: BotConfig
  isSelected: boolean
  onClick: () => void
}

const iconMap = {
  Cpu,
  RefreshCw,
  Zap,
  ArrowRight,
}

export function BotListItem({ bot, isSelected, onClick }: BotListItemProps) {
  const Icon = iconMap[bot.icon as keyof typeof iconMap] || Cpu

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-md cursor-pointer hover:bg-accent/50 transition-colors",
        isSelected && "bg-accent",
      )}
      onClick={onClick}
    >
      <div className={cn("p-2 rounded-md", getBotTypeColor(bot.type))}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="font-medium truncate">{bot.name}</p>
          <div className={cn("h-2 w-2 rounded-full", getStatusColor(bot.status))} />
        </div>
        <p className="text-xs text-muted-foreground">
          {bot.exchange} • {bot.pair}
        </p>
        <div className="flex items-center mt-1">
          <Badge variant={bot.profitability >= 0 ? "default" : "destructive"} className="text-xs">
            {bot.profitability >= 0 ? "+" : ""}
            {bot.profitability}%
          </Badge>
          <p className="text-xs text-muted-foreground ml-2">{bot.lastRun}</p>
        </div>
      </div>
    </div>
  )
}
