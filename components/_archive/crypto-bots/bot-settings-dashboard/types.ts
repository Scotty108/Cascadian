export interface BotConfig {
  id: string
  name: string
  type: string
  icon: string
  status: "active" | "paused" | "inactive"
  exchange: string
  pair: string
  strategy: string
  profitability: number
  lastRun: string
  description: string
  createdAt: string
  updatedAt: string
  totalTrades: number
  winRate: number
  balance: number
}

export interface RiskLevel {
  value: string
  label: string
  description: string
}

export interface Timeframe {
  value: string
  label: string
}

export interface Strategy {
  value: string
  label: string
}

export interface Exchange {
  value: string
  label: string
}

export interface BotSettingsState {
  selectedBot: string
  searchQuery: string
  showApiKey: boolean
  riskLevel: string
  timeframe: string
  strategy: string
  exchange: string
  tradingPair: string
  maxPositionSize: number
  stopLossPercentage: number
  takeProfitPercentage: number
  trailingStopLoss: boolean
  trailingTakeProfit: boolean
  aiAssistance: boolean
  autoRebalance: boolean
  notificationsEnabled: boolean
  telegramNotifications: boolean
  emailNotifications: boolean
  pushNotifications: boolean
  botName: string
  botType: string
  apiKey: string
  apiSecret: string
  autoStart: boolean
  // Strategy parameters
  rsiPeriod: number
  rsiOverbought: number
  rsiOversold: number
  macdFast: number
  macdSlow: number
  macdSignal: number
  bollingerPeriod: number
  bollingerStd: number
  meanLookback: number
  dcaInterval: string
  dcaAmount: number
  dcaDynamic: boolean
  customStrategyJson: string
  // Risk management
  minPositionSize: number
  minPositionCurrency: string
  maxOpenPositions: number
  maxDrawdown: number
  // Advanced settings
  executionMode: string
  orderType: string
  slippageTolerance: number
  retryAttempts: number
  executionSchedule: string
  debugMode: boolean
  testMode: boolean
}

export interface ActivityItem {
  id: string
  type: "buy" | "sell" | "signal" | "update" | "stop" | "start"
  title: string
  description: string
  timestamp: string
  icon: string
  color: string
}

export interface PerformanceMetrics {
  totalProfit: number
  totalProfitPercentage: number
  winRate: number
  totalTrades: number
  winningTrades: number
  avgProfit: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  sharpeRatio: number
  avgTradeDuration: string
}

export interface CreateBotFormData {
  name: string
  type: string
  exchange: string
  pair: string
  strategy: string
  description: string
}

export interface ImportExportData {
  bots: BotConfig[]
  settings: BotSettingsState[]
  exportDate: string
  version: string
}
