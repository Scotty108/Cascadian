// Utility function for consistent date formatting
export const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

// Utility function for formatting currency
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

// Utility function for formatting percentage
export const formatPercentage = (value: number) => {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

// Utility function for calculating profit/loss color
export const getProfitColor = (profit: number | null) => {
  if (profit === null) return "text-muted-foreground"
  return profit > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
}

// Utility function for getting status color
export const getStatusColor = (status: string) => {
  switch (status) {
    case "active":
      return "border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-400"
    case "completed":
      return "border-green-200 bg-green-100 text-green-700 dark:border-green-900 dark:bg-green-900/30 dark:text-green-400"
    case "stopped":
      return "border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-400"
    default:
      return "border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-900 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

// Utility function for getting signal type color
export const getSignalTypeColor = (type: "LONG" | "SHORT") => {
  return type === "LONG"
    ? "border-green-200 bg-green-100 text-green-700 dark:border-green-900 dark:bg-green-900/30 dark:text-green-400"
    : "border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-400"
}
