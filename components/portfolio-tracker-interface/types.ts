export interface PortfolioOverview {
  totalValue: number
  dailyChange: number
  weeklyChange: number
  monthlyChange: number
  yearlyChange: number
  allTimeChange: number
  allTimeROI: number
  assets: number
  chains: number
  protocols: number
}

export interface AllocationData {
  name: string
  value: number
  color: string
}

export interface HistoricalData {
  date: string
  value: number
  btc: number
  eth: number
}

export interface Asset {
  id: number
  name: string
  symbol: string
  icon: string
  price: number
  holdings: number
  value: number
  allocation: number
  pnl: number
  cost: number
  chain: string
}

export interface DeFiPosition {
  id: number
  protocol: string
  chain: string
  type: string
  asset: string
  amount: string | number
  value: number
  apy: number
  rewards: number
  risk: "Low" | "Medium" | "High"
}

export interface NFTCollection {
  id: number
  name: string
  items: number
  value: number
  floorPrice: number
  chain: string
}

export interface Transaction {
  id: number
  type: string
  asset: string
  amount: string | number
  price: number
  value: number
  date: string
  status: string
  chain: string
}

export interface RiskMetric {
  label: string
  value: string
  percentage: number
  color: string
}

export interface PortfolioMetric {
  label: string
  value: string
  isPositive?: boolean
}

export interface OptimizationSuggestion {
  title: string
  description: string
}

export interface FilterState {
  search: string
  assetFilter: string
  transactionType: string
  positionType: string
  chain: string
  dateRange: {
    from: string
    to: string
  }
}

export interface ViewState {
  timeRange: string
  viewMode: "grid" | "list"
  activeTab: string
}
