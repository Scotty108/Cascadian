export interface YieldFarmingOpportunity {
  id: number
  protocol: string
  asset: string
  apy: number
  tvl: number
  risk: string
  rewards: string[]
  chain: string
  logo: string
  verified: boolean
  impermanentLoss: string
  farmType: string
  depositFee: number
  withdrawFee: number
  harvestLockup: string
  lastHarvest: string
  // Enhanced fields
  riskScore?: number
  optimizationSuggestion?: string
  liquidityDepth?: number
  volumeChange24h?: number
  socialSentiment?: "positive" | "neutral" | "negative"
}

export interface UserFarm {
  id: number
  protocol: string
  asset: string
  deposited: number
  depositValue: number
  rewards: number
  apy: number
  timeStaked: string
  logo: string
  // Enhanced fields
  autoCompoundEnabled?: boolean
  lastHarvest?: Date
  totalEarned?: number
  impermanentLoss?: number
}

export interface PortfolioAllocation {
  name: string
  value: number
  color: string
  percentage?: number
  change24h?: number
  [key: string]: string | number | undefined
}

export interface GasData {
  slow: { price: number; time: string }
  average: { price: number; time: string }
  fast: { price: number; time: string }
}

export interface HistoricalApyData {
  date: string
  apy: number
  volume?: number
  tvl?: number
}

export interface ImpermanentLossCalculatorValues {
  token1Change: number
  token2Change: number
  initialInvestment: number
}

export interface FilterState {
  searchQuery: string
  selectedChains: string[]
  selectedRisks: string[]
  selectedFarmTypes: string[]
  apyRange: number[]
  tvlRange: number[]
  sortBy: string
  sortOrder: "asc" | "desc"
  // Enhanced filters
  minLiquidity?: number
  maxImpermanentLoss?: string
  verifiedOnly?: boolean
  socialSentiment?: string[]
}

export interface YieldFarmingState {
  activeTab: string
  filteredOpportunities: YieldFarmingOpportunity[]
  favoriteOpportunities: number[]
  selectedOpportunity: YieldFarmingOpportunity | null
  showFilters: boolean
  showImpermanentLossCalculator: boolean
  showAdvancedSettings: boolean
  gasOption: string
  autocompoundEnabled: boolean
  harvestThreshold: number
  ilCalculatorValues: ImpermanentLossCalculatorValues
}

// New enhanced types
export interface WalletState {
  isConnected: boolean
  address: string | null
  balance: number
  chainId: number
  supportedTokens: string[]
}

export interface Transaction {
  id: string
  type: "deposit" | "withdraw" | "harvest" | "compound"
  opportunityId: number
  amount: number
  timestamp: Date
  status: "pending" | "completed" | "failed"
  hash?: string
  gasUsed?: number
  error?: string
}

export interface TransactionState {
  pending: Transaction[]
  completed: Transaction[]
  failed: Transaction[]
}

export interface Notification {
  id: number
  type: "success" | "error" | "warning" | "info" | "harvest"
  title: string
  message: string
  timestamp: Date
  read: boolean
  actionUrl?: string
}

export interface NotificationSettings {
  apyChanges: boolean
  harvestReminders: boolean
  riskWarnings: boolean
  newOpportunities: boolean
}

export interface NotificationState {
  alerts: Notification[]
  settings: NotificationSettings
}

export interface YieldOptimization {
  currentYield: number
  optimizedYield: number
  suggestions: string[]
  riskAdjustment: number
  timeframe: string
}

export interface RiskAssessment {
  score: number
  factors: {
    smartContract: number
    impermanentLoss: number
    liquidity: number
    protocol: number
  }
  recommendation: "low" | "medium" | "high" | "very-high"
}

export interface PerformanceMetrics {
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number
  maxDrawdown: number
  winRate: number
  averageHoldTime: number
}
