import type { Asset, Account } from "./types"

export const formatNumber = (num: number): string => {
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export const formatCurrency = (num: number): string => {
  return `$${formatNumber(num)}`
}

export const formatPercentage = (num: number): string => {
  const sign = num >= 0 ? "+" : ""
  return `${sign}${num.toFixed(2)}%`
}

export const calculateTotalPortfolioValue = (assets: Asset[]): number => {
  return assets.reduce((sum, asset) => sum + asset.total, 0)
}

export const calculateTotalBtcValue = (assets: Asset[]): number => {
  return assets.reduce((sum, asset) => sum + asset.btcValue, 0)
}

export const filterAssets = (assets: Asset[], search: string, type: string): Asset[] => {
  return assets.filter((asset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(search.toLowerCase()) ||
      asset.symbol.toLowerCase().includes(search.toLowerCase())

    const matchesType =
      type === "all" ||
      (type === "crypto" && ["BTC", "ETH", "BNB", "ADA", "SOL", "DOT", "XRP"].includes(asset.symbol)) ||
      (type === "tokens" && !["BTC", "ETH"].includes(asset.symbol)) ||
      (type === "stablecoins" && ["USDT", "USDC", "BUSD"].includes(asset.symbol))

    return matchesSearch && matchesType
  })
}

export const filterAccounts = (accounts: Account[], search: string, type: string): Account[] => {
  return accounts.filter((account) => {
    const matchesSearch =
      account.name.toLowerCase().includes(search.toLowerCase()) ||
      account.type.toLowerCase().includes(search.toLowerCase())

    const matchesType =
      type === "all" ||
      (type === "spot" && account.type.toLowerCase().includes("spot")) ||
      (type === "futures" && account.type.toLowerCase().includes("futures")) ||
      (type === "defi" && account.type.toLowerCase().includes("defi"))

    return matchesSearch && matchesType
  })
}

export const getChangeColor = (change: number): string => {
  return change >= 0 ? "text-green-500" : "text-red-500"
}

export const getChangeIcon = (change: number): "up" | "down" => {
  return change >= 0 ? "up" : "down"
}
