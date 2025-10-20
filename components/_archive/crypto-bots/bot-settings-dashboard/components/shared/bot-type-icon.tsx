"use client"

import { cn } from "@/lib/utils"
import { Cpu, RefreshCw, Zap, ArrowRight } from "lucide-react"
import { getBotTypeColor } from "../../utils"

interface BotTypeIconProps {
  type: string
  className?: string
}

const iconMap = {
  "AI Bot": Cpu,
  "DCA Bot": RefreshCw,
  "Signal Bot": Zap,
  "Arbitrage Bot": ArrowRight,
}

export function BotTypeIcon({ type, className }: BotTypeIconProps) {
  const Icon = iconMap[type as keyof typeof iconMap] || Cpu

  return (
    <div className={cn("p-2 rounded-md", getBotTypeColor(type), className)}>
      <Icon className="h-5 w-5" />
    </div>
  )
}
