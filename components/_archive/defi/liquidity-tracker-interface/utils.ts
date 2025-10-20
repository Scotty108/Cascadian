import type { LiquidityPool, LiquidityPosition } from "./types"

export const formatCurrency = (value: string | number): string => {
  if (typeof value === "string") {
    return value
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export const formatPercentage = (value: string | number): string => {
  if (typeof value === "string") {
    return value
  }
  return `${value.toFixed(2)}%`
}

export const parseNumericValue = (value: string): number => {
  return Number.parseFloat(value.replace(/[^0-9.-]/g, ""))
}

export const getRiskColor = (risk: string): string => {
  switch (risk.toLowerCase()) {
    case "low":
      return "text-green-500"
    case "medium":
      return "text-yellow-500"
    case "high":
      return "text-red-500"
    default:
      return "text-gray-500"
  }
}

export const getRiskVariant = (risk: string): "outline" | "secondary" | "destructive" => {
  switch (risk.toLowerCase()) {
    case "low":
      return "outline"
    case "medium":
      return "secondary"
    case "high":
      return "destructive"
    default:
      return "outline"
  }
}

export const filterPools = (
  pools: LiquidityPool[],
  filters: {
    chain?: string
    protocol?: string
    minTvl?: string
    minApy?: string
    riskLevel?: string
    tokenPair?: string
    feeTier?: string
  },
): LiquidityPool[] => {
  return pools.filter((pool) => {
    // Chain filter
    if (filters.chain && filters.chain !== "all") {
      if (!pool.chain || pool.chain.toLowerCase() !== filters.chain.toLowerCase()) {
        return false
      }
    }

    // Protocol filter
    if (filters.protocol && filters.protocol !== "all") {
      if (!pool.protocol.toLowerCase().includes(filters.protocol.toLowerCase())) {
        return false
      }
    }

    // Min TVL filter
    if (filters.minTvl && filters.minTvl !== "0") {
      const poolTvl = parseNumericValue(pool.tvl)
      const minTvl = Number.parseFloat(filters.minTvl)
      if (poolTvl < minTvl) {
        return false
      }
    }

    // Min APY filter
    if (filters.minApy && filters.minApy !== "0") {
      const poolApy = parseNumericValue(pool.apy)
      const minApy = Number.parseFloat(filters.minApy)
      if (poolApy < minApy) {
        return false
      }
    }

    // Risk level filter
    if (filters.riskLevel && filters.riskLevel !== "all") {
      if (pool.risk.toLowerCase() !== filters.riskLevel.toLowerCase()) {
        return false
      }
    }

    // Token pair filter
    if (filters.tokenPair && filters.tokenPair.trim()) {
      const searchTerm = filters.tokenPair.toLowerCase()
      if (!pool.name.toLowerCase().includes(searchTerm)) {
        return false
      }
    }

    // Fee tier filter
    if (filters.feeTier && filters.feeTier !== "all") {
      const poolFee = parseNumericValue(pool.fee)
      const targetFee = Number.parseFloat(filters.feeTier)
      if (Math.abs(poolFee - targetFee) > 0.001) {
        return false
      }
    }

    return true
  })
}

export const sortPools = (
  pools: LiquidityPool[],
  sortBy: string,
  sortOrder: "asc" | "desc" = "desc",
): LiquidityPool[] => {
  return [...pools].sort((a, b) => {
    let aValue: number | string
    let bValue: number | string

    switch (sortBy) {
      case "tvl":
        aValue = parseNumericValue(a.tvl)
        bValue = parseNumericValue(b.tvl)
        break
      case "volume24h":
        aValue = parseNumericValue(a.volume24h)
        bValue = parseNumericValue(b.volume24h)
        break
      case "apy":
        aValue = parseNumericValue(a.apy)
        bValue = parseNumericValue(b.apy)
        break
      case "name":
        aValue = a.name
        bValue = b.name
        break
      case "protocol":
        aValue = a.protocol
        bValue = b.protocol
        break
      default:
        return 0
    }

    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortOrder === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
    }

    if (typeof aValue === "number" && typeof bValue === "number") {
      return sortOrder === "asc" ? aValue - bValue : bValue - aValue
    }

    return 0
  })
}

export const calculatePortfolioMetrics = (positions: LiquidityPosition[]) => {
  const totalInvested = positions.reduce((sum, pos) => sum + parseNumericValue(pos.invested), 0)
  const totalCurrentValue = positions.reduce((sum, pos) => sum + parseNumericValue(pos.currentValue), 0)
  const totalRewards = positions.reduce((sum, pos) => sum + parseNumericValue(pos.rewards), 0)

  const totalRoi = totalInvested > 0 ? ((totalCurrentValue - totalInvested) / totalInvested) * 100 : 0
  const averageApy =
    positions.length > 0 ? positions.reduce((sum, pos) => sum + parseNumericValue(pos.apy), 0) / positions.length : 0

  return {
    totalInvested,
    totalCurrentValue,
    totalRewards,
    totalRoi,
    averageApy,
  }
}

export const calculateImpermanentLoss = (initialPrice: number, currentPrice: number): number => {
  const priceRatio = currentPrice / initialPrice
  const impermanentLoss = (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1
  return impermanentLoss * 100
}

export const calculateLiquidityProviderReturns = (
  investmentAmount: number,
  apy: number,
  days: number,
  autocompound = false,
): {
  totalReturn: number
  feeEarnings: number
  impermanentLoss: number
  netReturn: number
} => {
  const dailyRate = apy / 365 / 100

  let totalReturn: number
  if (autocompound) {
    totalReturn = investmentAmount * Math.pow(1 + dailyRate, days)
  } else {
    totalReturn = investmentAmount * (1 + dailyRate * days)
  }

  const feeEarnings = totalReturn - investmentAmount
  const impermanentLoss = investmentAmount * 0.021 // Mock 2.1% IL
  const netReturn = feeEarnings - impermanentLoss

  return {
    totalReturn,
    feeEarnings,
    impermanentLoss,
    netReturn,
  }
}
