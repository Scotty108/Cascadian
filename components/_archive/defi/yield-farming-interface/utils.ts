import type { YieldFarmingOpportunity, FilterState, ImpermanentLossCalculatorValues, YieldOptimization } from "./types"

export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export const formatNumber = (value: number): string => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(1)}B`
  } else if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`
  } else {
    return `$${value.toFixed(0)}`
  }
}

export const formatPercentage = (value: number): string => {
  return `${value.toFixed(2)}%`
}

export const formatTimeAgo = (date: Date): string => {
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return `${diffInSeconds}s ago`
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  return `${Math.floor(diffInSeconds / 86400)}d ago`
}

export const calculateImpermanentLoss = (values: ImpermanentLossCalculatorValues) => {
  const { token1Change, token2Change, initialInvestment } = values

  // Convert percentage changes to ratios
  const p1 = 1 + token1Change / 100
  const p2 = 1 + token2Change / 100

  // Calculate the square root of the product of price ratios
  const sqrtP1P2 = Math.sqrt(p1 * p2)

  // Calculate impermanent loss as a percentage
  const ilPercentage = (2 * sqrtP1P2) / (p1 + p2) - 1

  // Calculate the dollar value of the impermanent loss
  const ilValue = initialInvestment * ilPercentage

  return {
    percentage: ilPercentage * 100,
    value: Math.abs(ilValue),
  }
}

export const assessRiskLevel = (opportunity: YieldFarmingOpportunity): number => {
  let riskScore = 0

  // Protocol risk (0-25 points)
  const protocolRisk = {
    Aave: 5,
    Compound: 5,
    Curve: 8,
    Uniswap: 12,
    SushiSwap: 15,
    PancakeSwap: 18,
    "Yearn Finance": 10,
    Balancer: 12,
  }
  riskScore += protocolRisk[opportunity.protocol as keyof typeof protocolRisk] || 20

  // APY risk (0-25 points) - higher APY = higher risk
  if (opportunity.apy > 50) riskScore += 25
  else if (opportunity.apy > 30) riskScore += 20
  else if (opportunity.apy > 15) riskScore += 15
  else if (opportunity.apy > 8) riskScore += 10
  else riskScore += 5

  // TVL risk (0-20 points) - lower TVL = higher risk
  if (opportunity.tvl < 10000000) riskScore += 20
  else if (opportunity.tvl < 50000000) riskScore += 15
  else if (opportunity.tvl < 100000000) riskScore += 10
  else if (opportunity.tvl < 500000000) riskScore += 5
  else riskScore += 0

  // Impermanent loss risk (0-20 points)
  const ilRisk = {
    None: 0,
    "Very Low": 3,
    Low: 8,
    Medium: 15,
    High: 20,
  }
  riskScore += ilRisk[opportunity.impermanentLoss as keyof typeof ilRisk] || 15

  // Chain risk (0-10 points)
  const chainRisk = {
    Ethereum: 2,
    BSC: 6,
    Polygon: 4,
    Avalanche: 3,
    Solana: 5,
  }
  riskScore += chainRisk[opportunity.chain as keyof typeof chainRisk] || 8

  return Math.min(100, riskScore)
}

export const calculateOptimalYield = (opportunity: YieldFarmingOpportunity, walletBalance: number): string => {
  const riskScore = assessRiskLevel(opportunity)
  const maxRecommendedAllocation = walletBalance * (riskScore < 30 ? 0.3 : riskScore < 50 ? 0.2 : 0.1)

  if (maxRecommendedAllocation < 100) {
    return "Insufficient balance for this farm"
  }

  if (riskScore < 30) {
    return `Low risk - Consider allocating up to ${formatCurrency(maxRecommendedAllocation)}`
  } else if (riskScore < 50) {
    return `Medium risk - Limit allocation to ${formatCurrency(maxRecommendedAllocation)}`
  } else {
    return `High risk - Only allocate ${formatCurrency(maxRecommendedAllocation)} or less`
  }
}

export const calculateYieldOptimization = (
  opportunities: YieldFarmingOpportunity[],
  walletBalance: number,
): YieldOptimization => {
  // Sort by risk-adjusted yield (APY / risk score)
  const sortedOpps = opportunities
    .map((opp) => ({
      ...opp,
      riskAdjustedYield: opp.apy / (assessRiskLevel(opp) / 10),
    }))
    .sort((a, b) => b.riskAdjustedYield - a.riskAdjustedYield)

  const currentYield = opportunities.reduce((sum, opp) => sum + opp.apy, 0) / opportunities.length
  const optimizedYield = sortedOpps.slice(0, 3).reduce((sum, opp) => sum + opp.apy, 0) / 3

  const suggestions = [
    `Focus on top 3 risk-adjusted opportunities: ${sortedOpps
      .slice(0, 3)
      .map((o) => o.protocol)
      .join(", ")}`,
    `Diversify across ${Math.min(5, sortedOpps.length)} different protocols`,
    `Maintain 60% in low-risk, 30% in medium-risk, 10% in high-risk farms`,
  ]

  return {
    currentYield,
    optimizedYield,
    suggestions,
    riskAdjustment: optimizedYield - currentYield,
    timeframe: "30 days",
  }
}

export const filterOpportunities = (
  opportunities: YieldFarmingOpportunity[],
  filters: FilterState,
  activeTab: string,
  favoriteOpportunities: number[],
  userFarmIds: number[],
): YieldFarmingOpportunity[] => {
  let filtered = [...opportunities]

  // Apply search filter
  if (filters.searchQuery) {
    filtered = filtered.filter(
      (opp) =>
        opp.protocol.toLowerCase().includes(filters.searchQuery.toLowerCase()) ||
        opp.asset.toLowerCase().includes(filters.searchQuery.toLowerCase()),
    )
  }

  // Apply chain filter
  if (filters.selectedChains.length > 0) {
    filtered = filtered.filter((opp) => filters.selectedChains.includes(opp.chain))
  }

  // Apply risk filter
  if (filters.selectedRisks.length > 0) {
    filtered = filtered.filter((opp) => filters.selectedRisks.includes(opp.risk))
  }

  // Apply farm type filter
  if (filters.selectedFarmTypes.length > 0) {
    filtered = filtered.filter((opp) => filters.selectedFarmTypes.includes(opp.farmType))
  }

  // Apply APY range filter
  filtered = filtered.filter((opp) => opp.apy >= filters.apyRange[0] && opp.apy <= filters.apyRange[1])

  // Apply TVL range filter
  filtered = filtered.filter((opp) => opp.tvl >= filters.tvlRange[0] && opp.tvl <= filters.tvlRange[1])

  // Apply enhanced filters
  if (filters.verifiedOnly) {
    filtered = filtered.filter((opp) => opp.verified)
  }

  if (filters.minLiquidity) {
    filtered = filtered.filter((opp) => (opp.liquidityDepth || 0) >= filters.minLiquidity!)
  }

  if (filters.maxImpermanentLoss) {
    const ilOrder = ["None", "Very Low", "Low", "Medium", "High"]
    const maxIndex = ilOrder.indexOf(filters.maxImpermanentLoss)
    filtered = filtered.filter((opp) => ilOrder.indexOf(opp.impermanentLoss) <= maxIndex)
  }

  if (filters.socialSentiment && filters.socialSentiment.length > 0) {
    filtered = filtered.filter((opp) => filters.socialSentiment!.includes(opp.socialSentiment || "neutral"))
  }

  // Apply tab filter
  if (activeTab === "my-farms") {
    filtered = filtered.filter((opp) => userFarmIds.includes(opp.id))
  } else if (activeTab === "favorites") {
    filtered = filtered.filter((opp) => favoriteOpportunities.includes(opp.id))
  }

  // Apply sorting
  filtered.sort((a, b) => {
    let aValue: any = a[filters.sortBy as keyof YieldFarmingOpportunity]
    let bValue: any = b[filters.sortBy as keyof YieldFarmingOpportunity]

    // Handle special sorting cases
    if (filters.sortBy === "riskScore") {
      aValue = assessRiskLevel(a)
      bValue = assessRiskLevel(b)
    }

    if (typeof aValue === "string") {
      aValue = aValue.toLowerCase()
      bValue = bValue.toLowerCase()
    }

    if (filters.sortOrder === "asc") {
      return aValue > bValue ? 1 : -1
    } else {
      return aValue < bValue ? 1 : -1
    }
  })

  return filtered
}

export const getImpermanentLossRiskValue = (risk: string): number => {
  switch (risk) {
    case "None":
      return 0
    case "Very Low":
      return 20
    case "Low":
      return 40
    case "Medium":
      return 60
    case "High":
      return 80
    default:
      return 100
  }
}

export const getRiskValue = (risk: string): number => {
  switch (risk) {
    case "Very Low":
      return 20
    case "Low":
      return 40
    case "Medium":
      return 60
    case "High":
      return 80
    default:
      return 100
  }
}

export const calculateAPR = (apy: number): number => {
  // Convert APY to APR (simple interest)
  return ((1 + apy / 100) ** (1 / 365) - 1) * 365 * 100
}

export const calculateCompoundFrequency = (apy: number, apr: number): number => {
  // Calculate how often rewards are compounded
  if (apy === apr) return 1 // No compounding
  return Math.log(apy / apr + 1) / Math.log(1 + apr / 100)
}

export const estimateGasCosts = (transactionType: string, gasPrice: number): number => {
  const gasLimits = {
    deposit: 150000,
    withdraw: 120000,
    harvest: 80000,
    compound: 200000,
  }

  const gasLimit = gasLimits[transactionType as keyof typeof gasLimits] || 100000
  return (gasLimit * gasPrice) / 1e9 // Convert to ETH
}

export const validateDepositAmount = (amount: number, balance: number, minDeposit = 0): string | null => {
  if (amount <= 0) return "Amount must be greater than 0"
  if (amount > balance) return "Insufficient balance"
  if (amount < minDeposit) return `Minimum deposit is ${formatCurrency(minDeposit)}`
  return null
}

export const calculateSlippage = (amount: number, liquidity: number): number => {
  // Simple slippage calculation based on amount vs liquidity
  return Math.min(5, (amount / liquidity) * 100) // Max 5% slippage
}
