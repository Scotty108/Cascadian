import type { BotConfig, ImportExportData } from "./types"

export const getStatusColor = (status: string): string => {
  switch (status) {
    case "active":
      return "bg-green-500"
    case "paused":
      return "bg-yellow-500"
    case "inactive":
      return "bg-gray-500"
    default:
      return "bg-gray-500"
  }
}

export const getBotTypeColor = (type: string): string => {
  switch (type) {
    case "AI Bot":
      return "bg-blue-500/10 text-blue-500"
    case "DCA Bot":
      return "bg-green-500/10 text-green-500"
    case "Signal Bot":
      return "bg-purple-500/10 text-purple-500"
    case "Arbitrage Bot":
      return "bg-orange-500/10 text-orange-500"
    default:
      return "bg-gray-500/10 text-gray-500"
  }
}

export const filterBots = (bots: BotConfig[], searchQuery: string): BotConfig[] => {
  if (!searchQuery.trim()) return bots

  const query = searchQuery.toLowerCase()
  return bots.filter(
    (bot) =>
      bot.name.toLowerCase().includes(query) ||
      bot.type.toLowerCase().includes(query) ||
      bot.exchange.toLowerCase().includes(query) ||
      bot.pair.toLowerCase().includes(query),
  )
}

export const formatCurrency = (amount: number, currency = "USD"): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount)
}

export const formatPercentage = (value: number): string => {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

export const validateApiKey = (apiKey: string): boolean => {
  return apiKey.length >= 32 && /^[a-zA-Z0-9]+$/.test(apiKey)
}

export const validateJsonStrategy = (jsonString: string): { isValid: boolean; error?: string } => {
  try {
    const parsed = JSON.parse(jsonString)

    // Basic validation for required fields
    if (!parsed.name || !parsed.version) {
      return { isValid: false, error: "Missing required fields: name, version" }
    }

    return { isValid: true }
  } catch (error) {
    return { isValid: false, error: "Invalid JSON format" }
  }
}

export const exportBotsToJson = (bots: BotConfig[]): string => {
  const exportData: ImportExportData = {
    bots,
    settings: [],
    exportDate: new Date().toISOString(),
    version: "1.0.0",
  }
  return JSON.stringify(exportData, null, 2)
}

export const exportBotsToCsv = (bots: BotConfig[]): string => {
  const headers = [
    "ID",
    "Name",
    "Type",
    "Status",
    "Exchange",
    "Pair",
    "Strategy",
    "Profitability (%)",
    "Total Trades",
    "Win Rate (%)",
    "Balance",
    "Created At",
    "Last Run",
  ]

  const rows = bots.map((bot) => [
    bot.id,
    bot.name,
    bot.type,
    bot.status,
    bot.exchange,
    bot.pair,
    bot.strategy,
    bot.profitability.toString(),
    bot.totalTrades.toString(),
    bot.winRate.toString(),
    bot.balance.toString(),
    bot.createdAt,
    bot.lastRun,
  ])

  return [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n")
}

export const downloadFile = (content: string, filename: string, contentType: string) => {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const generateBotId = (): string => {
  return `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export const validateBotName = (name: string): { isValid: boolean; error?: string } => {
  if (!name.trim()) {
    return { isValid: false, error: "Bot name is required" }
  }
  if (name.length < 3) {
    return { isValid: false, error: "Bot name must be at least 3 characters" }
  }
  if (name.length > 50) {
    return { isValid: false, error: "Bot name must be less than 50 characters" }
  }
  return { isValid: true }
}

export const sortBots = (bots: BotConfig[], sortBy: string, sortOrder: "asc" | "desc"): BotConfig[] => {
  return [...bots].sort((a, b) => {
    let aValue: any
    let bValue: any

    switch (sortBy) {
      case "name":
        aValue = a.name.toLowerCase()
        bValue = b.name.toLowerCase()
        break
      case "profitability":
        aValue = a.profitability
        bValue = b.profitability
        break
      case "status":
        aValue = a.status
        bValue = b.status
        break
      case "lastRun":
        aValue = new Date(a.updatedAt).getTime()
        bValue = new Date(b.updatedAt).getTime()
        break
      default:
        return 0
    }

    if (aValue < bValue) return sortOrder === "asc" ? -1 : 1
    if (aValue > bValue) return sortOrder === "asc" ? 1 : -1
    return 0
  })
}
