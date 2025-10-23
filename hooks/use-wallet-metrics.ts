/**
 * Calculate advanced wallet metrics from raw data
 */

import { useMemo } from 'react'

interface WalletPosition {
  size?: number
  shares?: number
  avgPrice?: number
  entry_price?: number
  entryPrice?: number
  currentValue?: number
  initialValue?: number
  cashPnl?: number
  unrealized_pnl?: number
  unrealizedPnL?: number
  percentPnl?: number
}

interface ClosedPosition {
  realizedPnl?: number
  realized_pnl?: number
  profit?: number
  avgPrice?: number
  entry_price?: number
  entryPrice?: number
  totalBought?: number
  size?: number
  endDate?: string
  closed_at?: string
}

interface Trade {
  timestamp?: string
  created_at?: string
  size?: number
  shares?: number
  price?: number
}

export interface WalletMetrics {
  // PnL metrics
  totalPnL: number
  totalPnLPct: number
  realizedPnL: number
  unrealizedPnL: number

  // Win/Loss
  winRate: number
  winningTrades: number
  losingTrades: number
  totalClosed: number

  // Investment
  totalInvested: number
  portfolioValue: number

  // Performance
  sharpeRatio: number
  sharpeLevel: string
  avgTradeSize: number

  // Activity
  daysActive: number
  totalTrades: number
  marketsTraded: number
  activeMarkets: number
  activePositions: number

  // Sparkline data for charts
  pnlHistory: Array<{ date: string; pnl: number }>
  volumeHistory: Array<{ date: string; volume: number }>
}

export function useWalletMetrics(
  positions: WalletPosition[],
  closedPositions: ClosedPosition[],
  trades: Trade[],
  portfolioValue: number
): WalletMetrics {
  return useMemo(() => {
    // Calculate unrealized PnL from open positions
    const unrealizedPnL = positions.reduce((sum, pos) => {
      return sum + (pos.cashPnl || pos.unrealized_pnl || pos.unrealizedPnL || 0)
    }, 0)

    // Calculate realized PnL from closed positions
    const realizedPnL = closedPositions.reduce((sum, pos) => {
      return sum + (pos.realizedPnl || pos.realized_pnl || pos.profit || 0)
    }, 0)

    // Total PnL
    const totalPnL = realizedPnL + unrealizedPnL

    // Calculate total invested (sum of all initial positions)
    const totalInvested = [
      ...positions.map(p => (p.avgPrice || p.entry_price || p.entryPrice || 0) * (p.size || p.shares || 0)),
      ...closedPositions.map(p => (p.avgPrice || p.entry_price || p.entryPrice || 0) * (p.totalBought || p.size || 0))
    ].reduce((sum, val) => sum + val, 0)

    // Calculate total PnL percentage
    const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0

    // Win/Loss metrics
    const winningTrades = closedPositions.filter(p => (p.realizedPnl || p.realized_pnl || p.profit || 0) > 0).length
    const losingTrades = closedPositions.filter(p => (p.realizedPnl || p.realized_pnl || p.profit || 0) < 0).length
    const totalClosed = closedPositions.length
    const winRate = totalClosed > 0 ? winningTrades / totalClosed : 0

    // Calculate Sharpe Ratio
    const returns = closedPositions.map(p => {
      const pnl = p.realizedPnl || p.realized_pnl || p.profit || 0
      const invested = (p.avgPrice || p.entry_price || p.entryPrice || 0) * (p.totalBought || p.size || 1)
      return invested > 0 ? pnl / invested : 0
    })

    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
      : 0
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0

    const sharpeLevel = sharpeRatio >= 2.0 ? 'Excellent' :
                       sharpeRatio >= 1.5 ? 'Very Good' :
                       sharpeRatio >= 1.0 ? 'Good' :
                       sharpeRatio >= 0.5 ? 'Fair' : 'Poor'

    // Average trade size
    const avgTradeSize = trades.length > 0
      ? trades.reduce((sum, t) => sum + ((t.size || t.shares || 0) * (t.price || 0)), 0) / trades.length
      : 0

    // Days active (from first trade to now)
    const timestamps = trades
      .map(t => t.timestamp || t.created_at)
      .filter((t): t is string => !!t)
      .map(t => new Date(t).getTime())

    const firstTrade = timestamps.length > 0 ? Math.min(...timestamps) : Date.now()
    const daysActive = Math.max(1, Math.floor((Date.now() - firstTrade) / (1000 * 60 * 60 * 24)))

    // Count unique markets
    const allMarkets = new Set([
      ...positions.map((p: any) => p.conditionId || p.market_id).filter(Boolean),
      ...closedPositions.map((p: any) => p.conditionId || p.market_id).filter(Boolean),
    ])
    const marketsTraded = allMarkets.size

    const activeMarkets = new Set(
      positions.map((p: any) => p.conditionId || p.market_id).filter(Boolean)
    ).size

    // PnL history (group closed positions by month for sparkline)
    const pnlHistory = closedPositions
      .map(pos => ({
        date: pos.endDate || pos.closed_at || new Date().toISOString(),
        pnl: pos.realizedPnl || pos.realized_pnl || pos.profit || 0
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Volume history (group trades by day)
    const volumeHistory = trades
      .map(trade => ({
        date: trade.timestamp || trade.created_at || new Date().toISOString(),
        volume: (trade.size || trade.shares || 0) * (trade.price || 0)
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    return {
      // PnL
      totalPnL,
      totalPnLPct,
      realizedPnL,
      unrealizedPnL,

      // Win/Loss
      winRate,
      winningTrades,
      losingTrades,
      totalClosed,

      // Investment
      totalInvested,
      portfolioValue,

      // Performance
      sharpeRatio,
      sharpeLevel,
      avgTradeSize,

      // Activity
      daysActive,
      totalTrades: trades.length,
      marketsTraded,
      activeMarkets,
      activePositions: positions.length,

      // History
      pnlHistory,
      volumeHistory,
    }
  }, [positions, closedPositions, trades, portfolioValue])
}
