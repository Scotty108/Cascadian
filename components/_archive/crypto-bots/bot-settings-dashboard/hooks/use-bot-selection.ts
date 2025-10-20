"use client"

import { useState, useMemo } from "react"
import type { BotConfig } from "../types"
import { filterBots } from "../utils"

export const useBotSelection = (bots: BotConfig[]) => {
  const [selectedBot, setSelectedBot] = useState<string>("bot-1")
  const [searchQuery, setSearchQuery] = useState("")

  const filteredBots = useMemo(() => {
    return filterBots(bots, searchQuery)
  }, [bots, searchQuery])

  const currentBot = useMemo(() => {
    return bots.find((bot) => bot.id === selectedBot)
  }, [bots, selectedBot])

  return {
    selectedBot,
    setSelectedBot,
    searchQuery,
    setSearchQuery,
    filteredBots,
    currentBot,
  }
}
