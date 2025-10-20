"use client"

import { useMemo } from "react"
import type { Asset } from "../types"
import { calculatePortfolioStats } from "../utils"

export function useAnalytics(assets: Asset[]) {
  const portfolioStats = useMemo(() => calculatePortfolioStats(assets), [assets])

  const riskAnalysis = useMemo(() => {
    // Calculate risk metrics based on portfolio composition
    const volatileAssets = assets.filter((asset) => ["BTC", "ETH", "SOL", "ADA", "DOT"].includes(asset.symbol))
    const stableAssets = assets.filter((asset) => ["USDC", "USDT", "DAI"].includes(asset.symbol))

    const volatilePercentage = volatileAssets.reduce((sum, asset) => sum + asset.allocation, 0)
    const stablePercentage = stableAssets.reduce((sum, asset) => sum + asset.allocation, 0)

    return {
      volatilePercentage,
      stablePercentage,
      diversificationScore: assets.length > 10 ? "Good" : assets.length > 5 ? "Medium" : "Poor",
      riskLevel: volatilePercentage > 70 ? "High" : volatilePercentage > 40 ? "Medium" : "Low",
    }
  }, [assets])

  const performanceMetrics = useMemo(() => {
    const winners = assets.filter((asset) => asset.pnl > 0)
    const losers = assets.filter((asset) => asset.pnl < 0)

    return {
      winRate: assets.length > 0 ? (winners.length / assets.length) * 100 : 0,
      avgGain: winners.length > 0 ? winners.reduce((sum, asset) => sum + asset.pnl, 0) / winners.length : 0,
      avgLoss: losers.length > 0 ? losers.reduce((sum, asset) => sum + asset.pnl, 0) / losers.length : 0,
      bestPerformer: assets.reduce((best, asset) => (asset.pnl > best.pnl ? asset : best), assets[0]),
      worstPerformer: assets.reduce((worst, asset) => (asset.pnl < worst.pnl ? asset : worst), assets[0]),
    }
  }, [assets])

  return {
    portfolioStats,
    riskAnalysis,
    performanceMetrics,
  }
}
