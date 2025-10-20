import type { PumpAlert } from "./types"

// Risk color mapping
export const getRiskColor = (risk: string) => {
  switch (risk.toLowerCase()) {
    case "low":
      return "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30"
    case "medium":
      return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
    case "high":
      return "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30"
    case "very high":
      return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30"
    default:
      return "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30"
  }
}

// Format timestamp to relative time
export const formatRelativeTime = (timestamp: number) => {
  const now = new Date().getTime()
  const diff = now - timestamp

  if (diff < 60000) {
    return "Just now"
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`
  } else {
    return `${Math.floor(diff / 86400000)}d ago`
  }
}

// Format large numbers
export const formatNumber = (num: number) => {
  if (num >= 1000000000) {
    return `$${(num / 1000000000).toFixed(2)}B`
  } else if (num >= 1000000) {
    return `$${(num / 1000000).toFixed(2)}M`
  } else if (num >= 1000) {
    return `$${(num / 1000).toFixed(2)}K`
  } else {
    return `$${num.toFixed(2)}`
  }
}

// Get profit potential color
export const getProfitPotentialColor = (potential: string) => {
  switch (potential.toLowerCase()) {
    case "extreme":
      return "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30"
    case "very high":
      return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30"
    case "high":
      return "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30"
    case "medium":
      return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
    default:
      return "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30"
  }
}

// Get anomaly type color
export const getAnomalyTypeColor = (type: string) => {
  switch (type.toLowerCase()) {
    case "volume spike":
      return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30"
    case "price surge":
      return "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30"
    case "social spike":
      return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
    case "whale activity":
      return "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30"
    case "divergence":
      return "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30"
    default:
      return "bg-gray-500/20 text-gray-600 dark:text-gray-400 border-gray-500/30"
  }
}

// Get activity level color
export const getActivityLevelColor = (level: string) => {
  switch (level.toLowerCase()) {
    case "very high":
      return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30"
    case "high":
      return "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30"
    case "medium":
      return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
    case "normal":
      return "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30"
    default:
      return "bg-gray-500/20 text-gray-600 dark:text-gray-400 border-gray-500/30"
  }
}

// Filter alerts based on parameters
export const filterAlerts = (alerts: PumpAlert[], filterParams: any) => {
  return alerts.filter((alert) => {
    if (filterParams.minPriceChange > 0 && alert.priceChange < filterParams.minPriceChange) {
      return false
    }
    if (filterParams.minVolumeChange > 0 && alert.volumeChange < filterParams.minVolumeChange) {
      return false
    }
    if (filterParams.timeFrame !== "all" && alert.timeFrame !== filterParams.timeFrame) {
      return false
    }
    if (filterParams.riskLevel !== "all" && alert.risk !== filterParams.riskLevel) {
      return false
    }
    if (!filterParams.exchanges.includes("all") && !filterParams.exchanges.includes(alert.exchange)) {
      return false
    }
    return true
  })
}
