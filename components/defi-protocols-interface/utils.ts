export const formatCurrency = (value: number): string => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(1)}B`
  } else if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`
  } else {
    return `$${value.toFixed(2)}`
  }
}

export const formatPercentage = (value: number): string => {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}%`
}

export const getChangeColor = (value: number): string => {
  return value > 0 ? "text-green-500" : "text-red-500"
}

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text
  return `${text.substring(0, maxLength)}...`
}

export const getRiskColor = (risk: "low" | "medium" | "high"): string => {
  switch (risk) {
    case "low":
      return "bg-green-500"
    case "medium":
      return "bg-yellow-500"
    case "high":
      return "bg-red-500"
    default:
      return "bg-gray-500"
  }
}

export const getRiskLabel = (risk: "low" | "medium" | "high"): string => {
  switch (risk) {
    case "low":
      return "Low Risk"
    case "medium":
      return "Medium Risk"
    case "high":
      return "High Risk"
    default:
      return "Unknown Risk"
  }
}
