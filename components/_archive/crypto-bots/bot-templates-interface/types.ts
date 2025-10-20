export type BotComplexity = "Beginner" | "Intermediate" | "Advanced"

export type BotTemplate = {
  id: string
  name: string
  description: string
  category: string
  type: string
  complexity: BotComplexity
  rating: number
  reviews: number
  creator: {
    name: string
    avatar: string
    verified: boolean
  }
  price: number | "Free"
  features: string[]
  exchanges: string[]
  assets: string[]
  performance: {
    winRate: number
    profitFactor: number
    maxDrawdown: number
    averageProfit: number
  }
  popularity: number
  lastUpdated: string
  image: string
  isFeatured: boolean
  isNew: boolean
  isFavorite: boolean
}

export type FilterOption = {
  value: string
  label: string
}

export type SortOption = {
  value: string
  label: string
}

export type CustomizationSettings = {
  riskLevel: number
  tradingPairs: string[]
  timeframe: string
  maxPositions: number
  stopLoss: number
  takeProfit: number
  reinvestProfits: boolean
  enableNotifications: boolean
  tradingHours: string
}

export type TemplateFilters = {
  searchQuery: string
  selectedCategory: string
  selectedType: string
  selectedComplexity: string
  sortBy: string
  activeTab: string
}
