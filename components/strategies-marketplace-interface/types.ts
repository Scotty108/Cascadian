export type StrategyCategory =
  | "All"
  | "AI-Powered"
  | "Trend Following"
  | "Mean Reversion"
  | "Breakout"
  | "Scalping"
  | "Grid Trading"
  | "DCA"
  | "Arbitrage"

export type PriceRange = "All" | "Free" | "Under $50" | "$50-$100" | "$100-$500" | "Over $500"

export type SortOption =
  | "Most Popular"
  | "Highest Rated"
  | "Newest"
  | "Highest Returns"
  | "Lowest Risk"
  | "Price: Low to High"
  | "Price: High to Low"

export type TimeFrame = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "All"

export type RiskLevel = "Low" | "Medium" | "High"

export interface Creator {
  id: string
  name: string
  avatar: string
  verified: boolean
  strategies: number
  followers: number
}

export interface StrategyReturns {
  daily: number
  weekly: number
  monthly: number
  yearly: number
}

export interface StrategySubscription {
  monthly: number
  yearly: number
}

export interface ChartDataPoint {
  date: string
  value: number
}

export interface Strategy {
  id: string
  name: string
  description: string
  category: StrategyCategory
  creator: Creator
  price: number
  subscription?: StrategySubscription
  isFree: boolean
  rating: number
  reviews: number
  purchases: number
  returns: StrategyReturns
  risk: RiskLevel
  winRate: number
  profitFactor: number
  maxDrawdown: number
  timeInMarket: number
  tradesPerDay: number
  supportedExchanges: string[]
  supportedPairs: string[]
  tags: string[]
  lastUpdated: string
  chartData: {
    [key in TimeFrame]: ChartDataPoint[]
  }
  isFeatured: boolean
  isNew: boolean
  isTrending: boolean
  isFavorite: boolean
  isPurchased: boolean
}

export interface FilterState {
  searchQuery: string
  selectedCategory: StrategyCategory
  selectedPriceRange: PriceRange
  sortOption: SortOption
  activeTab: string
}
