import type { StakingPool, FilterState } from "./types"

export const formatNumber = (num: number): string => {
  if (num >= 1000000000) {
    return `$${(num / 1000000000).toFixed(1)}B`
  } else if (num >= 1000000) {
    return `$${(num / 1000000).toFixed(1)}M`
  } else if (num >= 1000) {
    return `$${(num / 1000).toFixed(1)}K`
  }
  return `$${num.toFixed(2)}`
}

export const formatPercent = (num: number): string => {
  return `${num.toFixed(2)}%`
}

export const getRiskColor = (risk: string): string => {
  switch (risk) {
    case "Low":
      return "bg-green-500"
    case "Medium":
      return "bg-yellow-500"
    case "High":
      return "bg-red-500"
    default:
      return "bg-gray-500"
  }
}

export const calculateRewards = (principal: number, apy: number, days: number, compounding: string): number => {
  const rate = apy / 100

  if (compounding === "none") {
    // Simple interest
    return principal * (rate * (days / 365))
  } else {
    // Compound interest
    let periods = 1
    if (compounding === "daily") periods = days
    else if (compounding === "weekly") periods = Math.floor(days / 7)
    else if (compounding === "monthly") periods = Math.floor(days / 30)
    else if (compounding === "quarterly") periods = Math.floor(days / 90)
    else if (compounding === "yearly") periods = Math.floor(days / 365)

    const ratePerPeriod = rate / (365 / (days / periods))
    return principal * (Math.pow(1 + ratePerPeriod, periods) - 1)
  }
}

export const filterPools = (pools: StakingPool[], filters: FilterState): StakingPool[] => {
  let filteredPools = pools

  // Search filter
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase()
    filteredPools = filteredPools.filter(
      (pool) =>
        pool.name.toLowerCase().includes(query) ||
        pool.protocol.toLowerCase().includes(query) ||
        pool.token.toLowerCase().includes(query) ||
        pool.tokenSymbol.toLowerCase().includes(query),
    )
  }

  // Chain filter
  if (filters.selectedChains.length > 0) {
    filteredPools = filteredPools.filter((pool) => filters.selectedChains.includes(pool.chain))
  }

  // Risk level filter
  if (filters.selectedRiskLevels.length > 0) {
    filteredPools = filteredPools.filter((pool) => filters.selectedRiskLevels.includes(pool.riskLevel))
  }

  // Staking type filter
  if (filters.selectedStakingTypes.length > 0) {
    filteredPools = filteredPools.filter((pool) => filters.selectedStakingTypes.includes(pool.stakingType))
  }

  // APY filter
  if (filters.minApy > 0) {
    filteredPools = filteredPools.filter((pool) => pool.apy >= filters.minApy)
  }

  // Liquid staking filter
  if (filters.showLiquidStakingOnly) {
    filteredPools = filteredPools.filter((pool) => pool.isLiquidStaking)
  }

  // Verified filter
  if (filters.showVerifiedOnly) {
    filteredPools = filteredPools.filter((pool) => pool.isVerified)
  }

  // No lock filter
  if (filters.showNoLockOnly) {
    filteredPools = filteredPools.filter((pool) => pool.lockPeriod === null)
  }

  // Sort
  filteredPools = [...filteredPools].sort((a, b) => {
    if (filters.sortBy === "apy") {
      return filters.sortOrder === "desc" ? b.apy - a.apy : a.apy - b.apy
    } else if (filters.sortBy === "tvl") {
      return filters.sortOrder === "desc" ? b.tvl - a.tvl : a.tvl - b.tvl
    } else if (filters.sortBy === "name") {
      return filters.sortOrder === "desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    }
    return 0
  })

  return filteredPools
}
