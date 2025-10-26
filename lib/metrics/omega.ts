/**
 * Omega Ratio Calculation
 *
 * Omega ratio measures probability-weighted gains vs losses above a threshold.
 * For prediction market trading:
 * - Omega = Sum(Gains) / Sum(Losses) for closed positions
 * - Threshold = 0 (break-even)
 * - Higher omega = better asymmetric upside
 *
 * Omega Momentum measures if trader's edge is improving:
 * - Omega Momentum = (omega_30d - omega_60d) / omega_60d
 * - Positive = improving, Negative = declining
 */

import { clickhouse } from '@/lib/clickhouse/client'

export interface OmegaCalculation {
  omega_ratio: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  total_gains: number
  total_losses: number
  win_rate: number
  avg_gain: number
  avg_loss: number
  profit_factor: number // Similar to omega but different calculation
}

export interface OmegaMomentum {
  omega_30d: number
  omega_60d: number
  omega_momentum: number // (omega_30d - omega_60d) / omega_60d
  momentum_direction: 'improving' | 'declining' | 'stable'
  trades_30d: number
  trades_60d: number
}

/**
 * Calculate Omega ratio for a wallet over a time period
 */
export async function calculateOmegaRatio(
  walletAddress: string,
  daysBack: number = 30
): Promise<OmegaCalculation | null> {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000)

    // Query closed trades with PnL
    const query = `
      SELECT
        count() as total_trades,
        countIf(pnl > 0) as winning_trades,
        countIf(pnl <= 0) as losing_trades,
        sumIf(pnl, pnl > 0) as total_gains,
        sumIf(abs(pnl), pnl <= 0) as total_losses,
        avgIf(pnl, pnl > 0) as avg_gain,
        avgIf(pnl, pnl <= 0) as avg_loss
      FROM trades_raw
      WHERE
        wallet_address = '${walletAddress.toLowerCase()}'
        AND timestamp >= toDateTime(${cutoffTimestamp})
        AND is_closed = true
        AND pnl IS NOT NULL
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const data = await result.json<{
      total_trades: string
      winning_trades: string
      losing_trades: string
      total_gains: string
      total_losses: string
      avg_gain: string
      avg_loss: string
    }>() as Array<{
      total_trades: string
      winning_trades: string
      losing_trades: string
      total_gains: string
      total_losses: string
      avg_gain: string
      avg_loss: string
    }>

    if (data.length === 0 || parseInt(data[0].total_trades) === 0) {
      return null
    }

    const row = data[0]
    const totalTrades = parseInt(row.total_trades)
    const winningTrades = parseInt(row.winning_trades)
    const losingTrades = parseInt(row.losing_trades)
    const totalGains = parseFloat(row.total_gains)
    const totalLosses = parseFloat(row.total_losses)
    const avgGain = parseFloat(row.avg_gain)
    const avgLoss = parseFloat(row.avg_loss)

    // Calculate Omega ratio
    // If no losses, omega is infinite (we'll cap it at 100)
    const omegaRatio = totalLosses === 0 ? 100 : totalGains / totalLosses

    // Win rate
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0

    // Profit factor (related metric)
    const profitFactor = totalLosses === 0 ? (totalGains > 0 ? 100 : 0) : totalGains / totalLosses

    return {
      omega_ratio: omegaRatio,
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      total_gains: totalGains,
      total_losses: totalLosses,
      win_rate: winRate,
      avg_gain: avgGain,
      avg_loss: Math.abs(avgLoss),
      profit_factor: profitFactor,
    }
  } catch (error) {
    console.error(`[Omega] Failed to calculate for ${walletAddress}:`, error)
    return null
  }
}

/**
 * Calculate Omega momentum (30d vs 60d comparison)
 */
export async function calculateOmegaMomentum(
  walletAddress: string
): Promise<OmegaMomentum | null> {
  try {
    const omega30d = await calculateOmegaRatio(walletAddress, 30)
    const omega60d = await calculateOmegaRatio(walletAddress, 60)

    if (!omega30d || !omega60d) {
      return null
    }

    // Omega momentum = (omega_30d - omega_60d) / omega_60d
    const omegaMomentum =
      omega60d.omega_ratio === 0 ? 0 : (omega30d.omega_ratio - omega60d.omega_ratio) / omega60d.omega_ratio

    // Determine direction
    let direction: 'improving' | 'declining' | 'stable'
    if (omegaMomentum > 0.1) {
      // >10% improvement
      direction = 'improving'
    } else if (omegaMomentum < -0.1) {
      // >10% decline
      direction = 'declining'
    } else {
      direction = 'stable'
    }

    return {
      omega_30d: omega30d.omega_ratio,
      omega_60d: omega60d.omega_ratio,
      omega_momentum: omegaMomentum,
      momentum_direction: direction,
      trades_30d: omega30d.total_trades,
      trades_60d: omega60d.total_trades,
    }
  } catch (error) {
    console.error(`[Omega] Failed to calculate momentum for ${walletAddress}:`, error)
    return null
  }
}

/**
 * Calculate Sharpe ratio (risk-adjusted returns)
 * Sharpe = (Mean Return - Risk-Free Rate) / Std Dev of Returns
 * For simplicity, we'll use 0 as risk-free rate
 */
export async function calculateSharpeRatio(
  walletAddress: string,
  daysBack: number = 30
): Promise<number | null> {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000)

    const query = `
      SELECT
        avg(pnl) as mean_return,
        stddevPop(pnl) as std_dev
      FROM trades_raw
      WHERE
        wallet_address = '${walletAddress.toLowerCase()}'
        AND timestamp >= toDateTime(${cutoffTimestamp})
        AND is_closed = true
        AND pnl IS NOT NULL
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const data = await result.json<{
      mean_return: string
      std_dev: string
    }>() as Array<{
      mean_return: string
      std_dev: string
    }>

    if (data.length === 0) {
      return null
    }

    const meanReturn = parseFloat(data[0].mean_return)
    const stdDev = parseFloat(data[0].std_dev)

    if (stdDev === 0) {
      return null // Can't calculate if no variance
    }

    // Sharpe ratio = mean / std_dev (assuming risk-free rate = 0)
    return meanReturn / stdDev
  } catch (error) {
    console.error(`[Sharpe] Failed to calculate for ${walletAddress}:`, error)
    return null
  }
}

/**
 * Get all metrics for a wallet
 */
export async function calculateAllMetrics(walletAddress: string) {
  const [omega30d, omega60d, momentum, sharpe30d] = await Promise.all([
    calculateOmegaRatio(walletAddress, 30),
    calculateOmegaRatio(walletAddress, 60),
    calculateOmegaMomentum(walletAddress),
    calculateSharpeRatio(walletAddress, 30),
  ])

  return {
    wallet_address: walletAddress,
    omega_30d: omega30d,
    omega_60d: omega60d,
    omega_momentum: momentum,
    sharpe_30d: sharpe30d,
  }
}
