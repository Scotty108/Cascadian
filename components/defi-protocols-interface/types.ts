export interface Protocol {
  id: string
  name: string
  category: string
  icon: string
  tvl: number
  tvlChange: number
  apy: number
  risk: "low" | "medium" | "high"
  chains: string[]
  description: string
  audited: boolean
  governance: boolean
  favorite: boolean
  website?: string
  auditReports?: string[]
}

export interface Chain {
  id: string
  name: string
  icon: string
}

export interface RiskLevel {
  color: string
  label: string
}

export interface ProtocolFilters {
  category: string
  chain: string
  searchQuery: string
  showOnlyFavorites: boolean
  showOnlyAudited: boolean
  riskFilter: string[]
}

export interface SortConfig {
  field: string
  order: "asc" | "desc"
}

export interface ChartData {
  name: string
  [key: string]: string | number
}

export interface DistributionData {
  name: string
  value: number
}

export interface YieldOpportunity {
  protocol: string
  protocolIcon: string
  asset: string
  assetIcon: string
  strategy: string
  apy: number
  risk: "low" | "medium" | "high"
  chain: string
  chainIcon: string
}

export interface GovernanceProposal {
  id: string
  protocol: string
  title: string
  description: string
  status: "active" | "passed" | "failed"
  endDate: string
  forPercentage: number
}
