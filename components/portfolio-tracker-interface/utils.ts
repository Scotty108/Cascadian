import type { Asset, DeFiPosition, Transaction, FilterState } from "./types"

export const formatCurrency = (value: number, decimals = 2): string => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export const formatPercentage = (value: number, decimals = 2): string => {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`
}

export const formatHoldings = (value: number): string => {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  })
}

export const getChangeColor = (value: number): string => {
  return value >= 0 ? "text-green-500" : "text-red-500"
}

export const getRiskBadgeVariant = (risk: string) => {
  switch (risk) {
    case "Low":
      return "outline"
    case "Medium":
      return "secondary"
    case "High":
      return "destructive"
    default:
      return "outline"
  }
}

export const getTransactionBadgeVariant = (type: string) => {
  if (type === "Buy" || type === "Deposit" || type === "Stake") {
    return "outline"
  } else if (type === "Sell" || type === "Withdraw") {
    return "secondary"
  } else {
    return "default"
  }
}

export const filterAssets = (assets: Asset[], filters: FilterState): Asset[] => {
  return assets.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(filters.search.toLowerCase()) ||
      asset.symbol.toLowerCase().includes(filters.search.toLowerCase())

    const matchesFilter =
      filters.assetFilter === "all" ||
      (filters.assetFilter === "gainers" && asset.pnl > 0) ||
      (filters.assetFilter === "losers" && asset.pnl < 0) ||
      (filters.assetFilter === "largest" && asset.value > 10000) ||
      (filters.assetFilter === "smallest" && asset.value <= 10000)

    return matchesSearch && matchesFilter
  })
}

export const filterDeFiPositions = (positions: DeFiPosition[], filters: FilterState): DeFiPosition[] => {
  return positions.filter((position) => {
    const matchesSearch =
      position.protocol.toLowerCase().includes(filters.search.toLowerCase()) ||
      position.asset.toLowerCase().includes(filters.search.toLowerCase())

    const matchesType =
      filters.positionType === "all" || position.type.toLowerCase() === filters.positionType.toLowerCase()

    return matchesSearch && matchesType
  })
}

export const filterTransactions = (transactions: Transaction[], filters: FilterState): Transaction[] => {
  return transactions.filter((transaction) => {
    const matchesSearch = transaction.asset.toLowerCase().includes(filters.search.toLowerCase())

    const matchesType =
      filters.transactionType === "all" || transaction.type.toLowerCase() === filters.transactionType.toLowerCase()

    return matchesSearch && matchesType
  })
}

export const calculatePortfolioStats = (assets: Asset[]) => {
  const totalValue = assets.reduce((sum, asset) => sum + asset.value, 0)
  const totalCost = assets.reduce((sum, asset) => sum + asset.cost, 0)
  const totalPnL = totalValue - totalCost
  const totalPnLPercentage = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0

  return {
    totalValue,
    totalCost,
    totalPnL,
    totalPnLPercentage,
    assetCount: assets.length,
  }
}
