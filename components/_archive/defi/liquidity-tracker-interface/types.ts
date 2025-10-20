export interface LiquidityPool {
  id: number
  name: string
  protocol: string
  chain?: string
  tvl: string
  volume24h: string
  volume7d?: string
  apy: string
  fee: string
  impermanentLoss: string
  risk: "Low" | "Medium" | "High"
}

export interface LiquidityPosition {
  id: number
  name: string
  protocol: string
  invested: string
  currentValue: string
  roi: string
  apy: string
  rewards: string
  status: "Active" | "Inactive"
}

export interface LiquidityMiningOpportunity {
  id: number
  name: string
  protocol: string
  rewards: string
  apy: string
  duration: string
  tvl: string
  status: "Active" | "Inactive"
}

export interface ChartDataPoint {
  name: string
  uniswap: number
  curve: number
  balancer: number
  sushiswap: number
  total?: number
}

export interface VolumeDataPoint {
  name: string
  uniswap: number
  curve: number
  balancer: number
  sushiswap: number
}

export interface ProtocolDistribution {
  name: string
  value: number
  [key: string]: string | number
}

export interface FilterState {
  selectedChain: string
  selectedProtocol: string
  timeRange: string
  showAdvancedFilters: boolean
  minTvl: string
  minApy: string
  riskLevel: string
  tokenPair: string
  feeTier: string
  slippageTolerance: number[]
}

export interface CalculatorState {
  investmentAmount: string
  token1Amount: string
  token2Amount: string
  priceImpact: string
  estimatedFees: string
  autocompound: boolean
  selectedPool: string
  timePeriod: string
  minPrice: string
  maxPrice: string
}

export interface LiquidityTrackerState {
  activeTab: string
  filters: FilterState
  calculator: CalculatorState
  isLoading: boolean
  selectedPools: number[]
  favoriteOpportunities: number[]
}
