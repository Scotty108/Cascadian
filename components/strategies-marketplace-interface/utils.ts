import type { RiskLevel, Strategy, StrategyCategory, PriceRange, SortOption } from "./types"

export const getRiskColor = (risk: RiskLevel): string => {
  switch (risk) {
    case "Low":
      return "text-green-500"
    case "Medium":
      return "text-yellow-500"
    case "High":
      return "text-red-500"
    default:
      return ""
  }
}

export const getReturnColor = (value: number): string => {
  if (value > 0) return "text-green-500"
  if (value < 0) return "text-red-500"
  return ""
}

export const formatPrice = (price: number): string => {
  if (price === 0) return "Free"
  return `$${price.toFixed(2)}`
}

export const formatNumber = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export const formatPercentage = (value: number): string => {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`
}

export const filterStrategies = (
  strategies: Strategy[],
  searchQuery: string,
  selectedCategory: StrategyCategory,
  selectedPriceRange: PriceRange,
  activeTab: string,
): Strategy[] => {
  let result = [...strategies]

  // Filter by tab
  if (activeTab === "purchased") {
    result = result.filter((strategy) => strategy.isPurchased)
  } else if (activeTab === "favorites") {
    result = result.filter((strategy) => strategy.isFavorite)
  } else if (activeTab === "featured") {
    result = result.filter((strategy) => strategy.isFeatured)
  }

  // Filter by search query
  if (searchQuery) {
    const query = searchQuery.toLowerCase()
    result = result.filter(
      (strategy) =>
        strategy.name.toLowerCase().includes(query) ||
        strategy.description.toLowerCase().includes(query) ||
        strategy.tags.some((tag) => tag.toLowerCase().includes(query)),
    )
  }

  // Filter by category
  if (selectedCategory !== "All") {
    result = result.filter((strategy) => strategy.category === selectedCategory)
  }

  // Filter by price range
  if (selectedPriceRange !== "All") {
    switch (selectedPriceRange) {
      case "Free":
        result = result.filter((strategy) => strategy.isFree)
        break
      case "Under $50":
        result = result.filter((strategy) => !strategy.isFree && strategy.price < 50)
        break
      case "$50-$100":
        result = result.filter((strategy) => strategy.price >= 50 && strategy.price <= 100)
        break
      case "$100-$500":
        result = result.filter((strategy) => strategy.price > 100 && strategy.price <= 500)
        break
      case "Over $500":
        result = result.filter((strategy) => strategy.price > 500)
        break
    }
  }

  return result
}

export const sortStrategies = (strategies: Strategy[], sortOption: SortOption): Strategy[] => {
  const result = [...strategies]

  switch (sortOption) {
    case "Most Popular":
      return result.sort((a, b) => b.purchases - a.purchases)
    case "Highest Rated":
      return result.sort((a, b) => b.rating - a.rating)
    case "Newest":
      return result.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    case "Highest Returns":
      return result.sort((a, b) => b.returns.monthly - a.returns.monthly)
    case "Lowest Risk":
      const riskValues = { Low: 1, Medium: 2, High: 3 }
      return result.sort((a, b) => riskValues[a.risk] - riskValues[b.risk])
    case "Price: Low to High":
      return result.sort((a, b) => a.price - b.price)
    case "Price: High to Low":
      return result.sort((a, b) => b.price - a.price)
    default:
      return result
  }
}

export const getCategoryIcon = (category: StrategyCategory) => {
  // This will be used in the strategy card component
  const iconMap = {
    "AI-Powered": "Brain",
    "Trend Following": "TrendingUp",
    "Mean Reversion": "RefreshCw",
    Breakout: "ArrowUpRight",
    Scalping: "Zap",
    "Grid Trading": "Sliders",
    DCA: "Clock",
    Arbitrage: "Repeat",
    All: "Package",
  }
  return iconMap[category] || "Package"
}
