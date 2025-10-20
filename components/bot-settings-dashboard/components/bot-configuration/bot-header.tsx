"use client"

import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Pause, Play, Power, Trash } from "lucide-react"
import type { BotConfig } from "../../types"

interface BotHeaderProps {
  bot?: BotConfig
  onAction: (action: "pause" | "resume" | "activate" | "delete") => void
}

export function BotHeader({ bot, onAction }: BotHeaderProps) {
  if (!bot) return null

  const getActionButton = () => {
    switch (bot.status) {
      case "active":
        return (
          <Button variant="outline" size="sm" onClick={() => onAction("pause")}>
            <Pause className="mr-2 h-4 w-4" />
            Pause
          </Button>
        )
      case "paused":
        return (
          <Button variant="outline" size="sm" onClick={() => onAction("resume")}>
            <Play className="mr-2 h-4 w-4" />
            Resume
          </Button>
        )
      default:
        return (
          <Button variant="outline" size="sm" onClick={() => onAction("activate")}>
            <Power className="mr-2 h-4 w-4" />
            Activate
          </Button>
        )
    }
  }

  return (
    <div className="flex items-start justify-between">
      <div>
        <CardTitle>{bot.name}</CardTitle>
        <CardDescription>{bot.description}</CardDescription>
      </div>
      <div className="flex items-center gap-2">
        {getActionButton()}
        <Button variant="destructive" size="sm" onClick={() => onAction("delete")}>
          <Trash className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  )
}
