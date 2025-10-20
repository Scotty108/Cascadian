import type { FilterOption, SortOption } from "./types"

export const CATEGORIES: FilterOption[] = [
  { value: "all", label: "All Categories" },
  { value: "AI", label: "AI & Machine Learning" },
  { value: "DCA", label: "Dollar-Cost Averaging" },
  { value: "Grid", label: "Grid Trading" },
  { value: "Arbitrage", label: "Arbitrage" },
  { value: "Scalping", label: "Scalping" },
  { value: "DeFi", label: "DeFi & Yield" },
  { value: "Technical", label: "Technical Analysis" },
]

export const TYPES: FilterOption[] = [
  { value: "all", label: "All Types" },
  { value: "Trend Following", label: "Trend Following" },
  { value: "Accumulation", label: "Accumulation" },
  { value: "Market Making", label: "Market Making" },
  { value: "Cross-Exchange", label: "Cross-Exchange" },
  { value: "Momentum", label: "Momentum" },
  { value: "Yield Farming", label: "Yield Farming" },
  { value: "Breakout", label: "Breakout" },
  { value: "Sentiment Analysis", label: "Sentiment Analysis" },
]

export const COMPLEXITY_LEVELS: FilterOption[] = [
  { value: "all", label: "All Levels" },
  { value: "Beginner", label: "Beginner" },
  { value: "Intermediate", label: "Intermediate" },
  { value: "Advanced", label: "Advanced" },
]

export const SORT_OPTIONS: SortOption[] = [
  { value: "popular", label: "Most Popular" },
  { value: "rating", label: "Highest Rated" },
  { value: "newest", label: "Newest First" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
  { value: "performance", label: "Best Performance" },
]

export const DEFAULT_CUSTOMIZATION_SETTINGS = {
  riskLevel: 50,
  tradingPairs: ["BTC/USDT"],
  timeframe: "1h",
  maxPositions: 3,
  stopLoss: 5,
  takeProfit: 10,
  reinvestProfits: false,
  enableNotifications: true,
  tradingHours: "24/7",
}

export const TRADING_PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ADA/USDT"]

export const TIMEFRAMES = [
  { value: "1m", label: "1 minute" },
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "1d", label: "1 day" },
]

export const TRADING_HOURS_OPTIONS = [
  { value: "24/7", label: "24/7" },
  { value: "weekdays", label: "Weekdays Only" },
  { value: "custom", label: "Custom Hours" },
]
