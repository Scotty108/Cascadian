import type { DcaBot, DcaStats } from "./types"

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export const formatPercentage = (value: number): string => {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

export const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

export const formatDateTime = (dateString: string): string => {
  return new Date(dateString).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const formatFullDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export const getStatusColor = (status: string): string => {
  switch (status) {
    case "active":
      return "text-green-500"
    case "paused":
      return "text-yellow-500"
    case "completed":
      return "text-blue-500"
    case "failed":
      return "text-red-500"
    default:
      return "text-gray-500"
  }
}

export const getProfitColor = (profit: number): string => {
  return profit >= 0 ? "text-green-500" : "text-red-500"
}

export const getStatusBadgeVariant = (status: string): "default" | "outline" | "secondary" => {
  switch (status) {
    case "active":
      return "default"
    case "paused":
      return "outline"
    default:
      return "secondary"
  }
}

export const calculateStats = (bots: DcaBot[]): DcaStats => {
  const totalBots = bots.length
  const activeBots = bots.filter((bot) => bot.status === "active").length
  const totalInvested = bots.reduce((sum, bot) => sum + bot.totalInvested, 0)
  const averageProfit = totalBots > 0 ? bots.reduce((sum, bot) => sum + bot.profit, 0) / totalBots : 0

  return {
    totalBots,
    activeBots,
    totalInvested,
    averageProfit,
  }
}

export const getNextExecutionTime = (bot: DcaBot): string => {
  const nextExecution = new Date(bot.nextExecution)
  const now = new Date()
  const diffMs = nextExecution.getTime() - now.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return `in ${diffDays} day${diffDays > 1 ? "s" : ""}`
  } else if (diffHours > 0) {
    return `in ${diffHours} hour${diffHours > 1 ? "s" : ""}`
  } else {
    return "soon"
  }
}
