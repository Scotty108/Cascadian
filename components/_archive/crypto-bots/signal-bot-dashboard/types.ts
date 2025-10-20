export interface SignalProvider {
  id: string
  name: string
  avatar: string
  description: string
  accuracy: number
  signals: number
  subscribers: number
  price: string
  status: "active" | "inactive"
  favorite: boolean
}

export interface Signal {
  id: string
  provider: string
  providerAvatar: string
  asset: string
  type: "LONG" | "SHORT"
  entryPrice: number
  targetPrice: number
  stopLoss: number
  timestamp: string
  status: "active" | "completed" | "stopped"
  profit: number | null
  confidence: number
}

export interface PerformanceStats {
  totalSignals: number
  successRate: number
  avgProfit: number
  totalProfit: number
  activeSignals: number
  completedSignals: number
  stoppedSignals: number
}

export interface NotificationSettings {
  email: boolean
  push: boolean
  telegram: boolean
  discord: boolean
}

export interface SignalFilters {
  minConfidence: number
  favoriteProvidersOnly: boolean
  includeLong: boolean
  includeShort: boolean
}

export interface TradingSettings {
  botName: string
  description: string
  defaultExchange: string
  defaultPair: string
  positionSize: number
  positionSizeType: "percentage" | "fixed"
  maxPositions: number
  maxDailyTrades: number
}

export interface AdvancedSettings {
  positionSizePercent: number
  maxConcurrent: number
  stopLoss: number
  takeProfit: number
  trailingStop: boolean
  partialClose: boolean
  reinvestProfits: boolean
}

export interface SignalBotState {
  botActive: boolean
  autoTrade: boolean
  riskLevel: number[]
  notificationSettings: NotificationSettings
  signalFilters: SignalFilters
  tradingSettings: TradingSettings
  advancedSettings: AdvancedSettings
  showAdvancedSettings: boolean
  showAddProvider: boolean
  showProviderDetails: string | null
  historyFilter: string
}
