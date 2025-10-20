"use client"

import { cn } from "@/lib/utils"
import { getStatusColor } from "../../utils"

interface BotStatusIndicatorProps {
  status: "active" | "paused" | "inactive"
  className?: string
}

export function BotStatusIndicator({ status, className }: BotStatusIndicatorProps) {
  return <div className={cn("h-2 w-2 rounded-full", getStatusColor(status), className)} />
}
