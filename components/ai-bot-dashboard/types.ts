export interface BotData {
  name: string
  status: "active" | "inactive"
  type: string
  balance: number
  profit: {
    daily: number
    weekly: number
    monthly: number
    total: number
  }
  trades: {
    total: number
    successful: number
    failed: number
    winRate: number
  }
  assets: Asset[]
  recentTrades: Trade[]
  strategies: Strategy[]
  riskSettings: RiskSettings
  exchanges: Exchange[]
  aiInsights: AiInsight[]
  marketConditions: MarketConditions
}

export interface Asset {
  symbol: string
  allocation: number
  price: number
  change24h: number
}

export interface Trade {
  id: string
  time: string
  pair: string
  type: "buy" | "sell"
  price: number
  amount: number
  status: "completed" | "pending" | "cancelled" | "failed"
  profit: number
}

export interface Strategy {
  id: string
  name: string
  description: string
  risk: "low" | "medium" | "high"
  timeframe: string
  active: boolean
}

export interface RiskSettings {
  maxDrawdown: number
  stopLoss: number
  takeProfit: number
  leverageLimit: number
  maxPositionSize: number
  dailyLossLimit: number
}

export interface Exchange {
  id: string
  name: string
  connected: boolean
  apiKeyStatus: string
  lastSync: string | null
}

export interface AiInsight {
  id: string
  timestamp: string
  message: string
  impact: "positive" | "negative" | "neutral"
}

export interface MarketConditions {
  overall: string
  volatility: string
  volume: string
  sentiment: string
}

export interface PerformanceData {
  date: string
  balance: number
  profit: number
  trades: number
  winrate: number
}

// New interfaces for analytics and news
export interface AssetAnalytics {
  technicalIndicators: TechnicalIndicator[]
  priceMetrics: PriceMetrics
  volumeAnalysis: VolumeAnalysis
  correlations: AssetCorrelation[]
  riskMetrics: RiskMetrics
  predictions: PricePrediction[]
}

export interface TechnicalIndicator {
  name: string
  value: number
  signal: "buy" | "sell" | "neutral"
  description: string
}

export interface PriceMetrics {
  volatility: number
  beta: number
  sharpeRatio: number
  maxDrawdown: number
  averageReturn: number
  standardDeviation: number
}

export interface VolumeAnalysis {
  averageVolume: number
  volumeTrend: "increasing" | "decreasing" | "stable"
  volumeRatio: number
  liquidityScore: number
}

export interface AssetCorrelation {
  asset: string
  correlation: number
  strength: "strong" | "moderate" | "weak"
}

export interface RiskMetrics {
  valueAtRisk: number
  conditionalVaR: number
  riskScore: number
  riskLevel: "low" | "medium" | "high"
}

export interface PricePrediction {
  timeframe: string
  predictedPrice: number
  confidence: number
  direction: "up" | "down" | "sideways"
}

export interface NewsItem {
  id: string
  title: string
  summary: string
  source: string
  publishedAt: string
  sentiment: "positive" | "negative" | "neutral"
  impact: "high" | "medium" | "low"
  url: string
  tags: string[]
  relevanceScore: number
}

export interface NewsFeed {
  items: NewsItem[]
  lastUpdated: string
  totalCount: number
}
