import type { LucideIcon } from "lucide-react"

export type StakingPool = {
  id: string
  name: string
  protocol: string
  token: string
  tokenSymbol: string
  tokenLogo: string
  apy: number
  tvl: number
  lockPeriod: number | null
  lockPeriodText: string
  minStake: number
  rewards: string[]
  rewardTokens: string[]
  rewardLogos: string[]
  riskLevel: "Low" | "Medium" | "High"
  isLiquidStaking: boolean
  isVerified: boolean
  chain: string
  chainLogo: string
  isFavorite: boolean
  description: string
  stakingType: "PoS" | "DPoS" | "Liquid" | "Governance" | "LP"
  stakingTypeLabel: string
  stakingTypeIcon: LucideIcon
}

export type ActiveStake = {
  id: string
  poolId: string
  poolName: string
  protocol: string
  token: string
  tokenSymbol: string
  tokenLogo: string
  stakedAmount: number
  stakedValue: number
  rewards: number
  rewardsValue: number
  rewardToken: string
  rewardTokenLogo: string
  apy: number
  startDate: string
  endDate: string | null
  isLocked: boolean
  remainingLockTime: number | null
  chain: string
  chainLogo: string
}

export type HistoricalData = {
  date: string
  apy: number
}

export type PortfolioAllocation = {
  name: string
  value: number
  color: string
}

export type FilterState = {
  searchQuery: string
  selectedChains: string[]
  selectedRiskLevels: string[]
  selectedStakingTypes: string[]
  minApy: number
  showLiquidStakingOnly: boolean
  showVerifiedOnly: boolean
  showNoLockOnly: boolean
  sortBy: string
  sortOrder: "asc" | "desc"
}

export type CalculatorState = {
  amount: string
  period: string
  apy: string
  compounding: string
}

export type StakeFormState = {
  amount: string
  gasOption: string
  autoCompound: boolean
}
