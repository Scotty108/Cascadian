"use client"

import { Badge } from "@/components/ui/badge"
import { ArrowRight, AlertCircle, RefreshCw, Shield, Clock } from "lucide-react"
import type { ActivityItem } from "../../types"

interface ActivityItemProps {
  item: ActivityItem
}

const iconMap = {
  buy: ArrowRight,
  sell: ArrowRight,
  signal: AlertCircle,
  update: RefreshCw,
  stop: Shield,
  start: Clock,
}

const colorMap = {
  green: "bg-green-500/10 text-green-500",
  yellow: "bg-yellow-500/10 text-yellow-500",
  blue: "bg-blue-500/10 text-blue-500",
  red: "bg-red-500/10 text-red-500",
  purple: "bg-purple-500/10 text-purple-500",
}

export function BotActivityItem({ item }: ActivityItemProps) {
  const Icon = iconMap[item.type] || ArrowRight
  const colorClass = colorMap[item.color as keyof typeof colorMap] || colorMap.green

  return (
    <div className="flex items-start gap-3">
      <div className={`p-2 rounded-md ${colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-medium">{item.title}</p>
          <Badge variant="outline" className="text-xs">
            {item.timestamp}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{item.description}</p>
      </div>
    </div>
  )
}
