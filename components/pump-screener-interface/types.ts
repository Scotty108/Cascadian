export interface PumpAlert {
  id: number
  symbol: string
  exchange: string
  priceChange: number
  volumeChange: number
  timeFrame: string
  currentPrice: number
  timestamp: number
  risk: "low" | "medium" | "high" | "very high"
  confidence: number
  marketCap: number
  volume24h: number
  socialMentions: number
  patternType: string
  previousPumps: number
}

export interface WatchlistItem {
  symbol: string
  exchange: string
  alert: boolean
  notes: string
}

export interface HistoricalPump {
  symbol: string
  date: string
  priceChangePct: number
  volumeIncreasePct: number
  duration: string
  peakPrice: number
  trigger: string
  profitPotential: string
}

export interface MarketOverview {
  totalCoins: number
  totalMarketCap: number
  total24hVolume: number
  btcDominance: number
  fearGreedIndex: number
  fearGreedLabel: string
  pumpingCoins: number
  dumpingCoins: number
  unusualActivity: number
  socialTrending: string[]
}

export interface FilterParams {
  minPriceChange: number
  minVolumeChange: number
  timeFrame: string
  riskLevel: string
  exchanges: string[]
}

export interface SocialPost {
  platform: "twitter" | "telegram"
  author: string
  handle: string
  content: string
  timestamp: string
}

export interface PumpPrediction {
  symbol: string
  name: string
  likelihood: number
  risk: "low" | "medium" | "high" | "very high"
  reasoning: string
}

export interface UnusualActivityItem {
  symbol: string
  price: string
  change24h: number
  volumeChange: number
  marketCap: string
  anomalyType: string
}
