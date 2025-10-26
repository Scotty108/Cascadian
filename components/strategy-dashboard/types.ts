// Strategy Dashboard Types for Polymarket Prediction Markets

import type { NodeGraph } from '@/lib/strategy-builder/types'

export interface StrategyData {
  id: string
  name: string
  description: string
  status: "active" | "paused" | "inactive"
  trading_mode?: "paper" | "live"  // Paper trading or live trading
  createdAt: string
  nodeGraph: NodeGraph  // The actual nodes and edges from the strategy
  balance: number
  initialBalance: number
  performance: {
    daily: number
    weekly: number
    monthly: number
    total: number
  }
  performanceData: PerformanceData[]
  positions: Position[]
  recentTrades: Trade[]
  watchSignals: WatchSignal[]
  statistics: StrategyStatistics
  settings: StrategySettings
  aiInsights: AiInsight[]
  marketConditions: MarketConditions
}

export interface Position {
  id: string
  marketId: string
  marketTitle: string
  marketSlug: string
  outcome: "YES" | "NO"
  shares: number
  averagePrice: number
  currentPrice: number
  unrealizedPnL: number
  realizedPnL: number
  category: string
  status: "open" | "closed"
  openedAt: string
  closedAt?: string
}

export interface Trade {
  id: string
  timestamp: string
  marketTitle: string
  type: "buy" | "sell"
  outcome: "YES" | "NO"
  shares: number
  price: number
  amount: number
  status: "completed" | "pending" | "failed"
  pnl?: number
  fees: number
}

export interface WatchSignal {
  id: string
  marketId: string
  marketTitle: string
  category: string
  currentPrice: number
  sii: number
  volume24h: number
  momentum: number
  flaggedAt: string
  reason: string
  confidence: "high" | "medium" | "low"
  suggestedOutcome: "YES" | "NO"
}

export interface StrategyStatistics {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  averageWin: number
  averageLoss: number
  profitFactor: number
  sharpeRatio: number
  maxDrawdown: number
  currentDrawdown: number
  activePositions: number
  closedPositions: number
}

export interface StrategySettings {
  maxPositionSize: number
  maxPositions: number
  stopLoss: number
  takeProfit: number
  categories: string[]
  minVolume: number
  minLiquidity: number
  siiThreshold: number
  momentumThreshold: number
  riskLevel: "low" | "medium" | "high"
}

export interface AiInsight {
  id: string
  timestamp: string
  message: string
  type: "opportunity" | "warning" | "info"
  impact: "positive" | "negative" | "neutral"
  actionable: boolean
}

export interface MarketConditions {
  overall: string
  volume: string
  volatility: string
  sentiment: string
  topCategories: string[]
}

export interface PerformanceData {
  date: string
  balance: number
  profit: number
  trades: number
  winRate: number
}
