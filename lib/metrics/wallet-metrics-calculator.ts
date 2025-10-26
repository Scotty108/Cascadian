/**
 * Wallet Metrics Calculator - Phase 1
 *
 * Implements Austin's 102-metric specification for prediction market traders
 * Phase 1 focuses on 30 core metrics that work with existing data
 *
 * Based on: Austin's spec (2025-10-25)
 * Data model: Binary $1-payout markets (Polymarket)
 */

import { fetchWalletPnL } from '@/lib/goldsky/client'

// ============================================================================
// Type Definitions
// ============================================================================

export interface Trade {
  // Core identifiers
  wallet_address: string
  market_id: string
  trade_id: string
  timestamp: Date

  // Trade details
  side: 'YES' | 'NO' // +1 for YES, -1 for NO
  shares: number // n_i = number of $1 shares
  entry_price: number // c_i = YES price at entry (0-1)
  close_price?: number // p_close_i = YES price before resolution (0-1)
  outcome?: 0 | 1 // y_i = outcome of YES contract (1=YES won, 0=NO won)

  // Cost breakdown
  usd_value: number // stake_cash_i
  fee_usd: number // fee_i
  slippage_usd: number

  // P&L (if resolved)
  pnl_gross?: number // Before fees
  pnl_net?: number // After all costs

  // Timing
  hours_held?: number // hours_i

  // Context
  category?: string
  bankroll_at_entry?: number // For sizing metrics
}

export interface MetricWindow {
  window: '30d' | '90d' | '180d' | 'lifetime'
  startDate?: Date
  endDate?: Date
}

export interface Phase1Metrics {
  // Window context
  window: MetricWindow['window']
  calculated_at: Date

  // Sample stats
  total_trades: number
  resolved_trades: number
  track_record_days: number
  bets_per_week: number

  // Base screeners (Austin's #1-24)
  omega_gross: number | null // #1: Omega(τ=0)
  omega_net: number | null // #2: Omega(τ=net fees)
  gain_to_pain: number | null // #3: GPR
  profit_factor: number | null // #4
  sortino: number | null // #5
  sharpe: number | null // #6
  // martin: number | null // #7 (requires Ulcer Index)
  // calmar: number | null // #8 (requires CAGR)
  net_pnl_usd: number // #9
  net_pnl_pct: number | null // #10
  // cagr: number | null // #11
  hit_rate: number | null // #12: Win rate
  avg_win_usd: number | null // #13
  avg_loss_usd: number | null // #14
  // ev_per_bet_mean: number | null // #15 (requires p_hat)
  // ev_per_bet_median: number | null // #16 (requires p_hat)
  max_drawdown: number | null // #17
  avg_drawdown: number | null // #18
  time_in_drawdown_pct: number | null // #19
  ulcer_index: number | null // #20
  // drawdown_recovery_days: number | null // #21
  resolved_bets: number // #22
  track_record_days_metric: number // #23
  bets_per_week_metric: number // #24

  // Advanced screeners (Austin's #25-47) - subset
  // brier_score: number | null // #25 (requires p_hat)
  // calibration_slope: number | null // #27 (requires p_hat)
  // clv_mean: number | null // #30 (requires close_price)
  downside_deviation: number | null // #36
  // cvar_95: number | null // #37
  max_single_trade_loss_pct: number | null // #38
  avg_holding_period_hours: number | null // #39
  // category_mix: Record<string, number> | null // #41
  concentration_hhi: number | null // #43
  stake_sizing_volatility: number | null // #44

  // Directional bias
  yes_no_bias_count_pct: number | null // #98: %YES - %NO by count
  yes_no_bias_notional_pct: number | null // #98: %YES - %NO by notional

  // Raw components (for debugging/verification)
  total_gains: number
  total_losses: number
  total_fees: number
  win_count: number
  loss_count: number
}

// ============================================================================
// Wallet Metrics Calculator Class
// ============================================================================

export class WalletMetricsCalculator {
  private walletAddress: string
  private trades: Trade[] = []

  constructor(walletAddress: string) {
    this.walletAddress = walletAddress.toLowerCase()
  }

  /**
   * Load trades from Goldsky PnL subgraph
   * Applies correction factor and filters to resolved trades
   */
  async loadTrades(): Promise<void> {
    console.log(`📊 Loading trades for ${this.walletAddress}...`)

    const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399
    const walletData = await fetchWalletPnL(this.walletAddress)

    if (!walletData || !walletData.positions) {
      console.log('⚠️  No positions found for wallet')
      this.trades = []
      return
    }

    // Convert positions to Trade format
    this.trades = walletData.positions
      .map((pos) => {
        // Apply correction factor to PnL
        const rawPnl = parseFloat(pos.realizedPnl)
        const correctedPnl = rawPnl / GOLDSKY_PNL_CORRECTION_FACTOR

        // Parse position data
        const amount = parseFloat(pos.amount)
        const avgPrice = parseFloat(pos.avgPrice)
        const totalBought = parseFloat(pos.totalBought)

        // Estimate side based on whether PnL is positive (rough approximation)
        // In reality, we'd need to know if the outcome was YES or NO
        const side: 'YES' | 'NO' = correctedPnl > 0 ? 'YES' : 'NO'

        return {
          wallet_address: this.walletAddress,
          market_id: pos.tokenId.substring(0, 20), // Use tokenId as market identifier
          trade_id: pos.id,
          timestamp: new Date(), // Unknown exact timestamp

          side,
          shares: Math.abs(amount),
          entry_price: avgPrice,
          outcome: correctedPnl !== 0 ? (correctedPnl > 0 ? 1 : 0) : undefined,

          usd_value: totalBought,
          fee_usd: 0, // Unknown from this query
          slippage_usd: 0,

          pnl_gross: correctedPnl,
          pnl_net: correctedPnl, // Same as gross (no fee data available)

          hours_held: undefined, // Unknown
          category: undefined,
          bankroll_at_entry: undefined,
        }
      })
      .filter((t) => t.pnl_gross !== 0) // Only resolved positions

    console.log(`✅ Loaded ${this.trades.length} resolved trades`)
  }

  /**
   * Calculate all Phase 1 metrics for a given window
   */
  async calculateMetrics(window: MetricWindow): Promise<Phase1Metrics> {
    // Filter trades to window
    const windowTrades = this.filterToWindow(this.trades, window)

    if (windowTrades.length === 0) {
      return this.emptyMetrics(window.window)
    }

    // Calculate each metric group
    const basic = this.calculateBasicStats(windowTrades)
    const omega = this.calculateOmegaMetrics(windowTrades)
    const risk = this.calculateRiskMetrics(windowTrades)
    const behavioral = this.calculateBehavioralMetrics(windowTrades)

    return {
      window: window.window,
      calculated_at: new Date(),

      // Sample stats
      total_trades: windowTrades.length,
      resolved_trades: windowTrades.filter((t) => t.pnl_net !== undefined).length,
      track_record_days: this.getTrackRecordDays(windowTrades),
      bets_per_week: this.getBetsPerWeek(windowTrades),

      // Merge all metric groups
      ...omega,
      ...basic,
      ...risk,
      ...behavioral,
    }
  }

  // ============================================================================
  // Metric Calculation Functions
  // ============================================================================

  /**
   * Austin's #1-2: Omega Ratio
   * Formula: Ω = Σ max(x_i, 0) / Σ max(-x_i, 0)
   */
  private calculateOmegaMetrics(trades: Trade[]) {
    const resolvedTrades = trades.filter((t) => t.pnl_net !== undefined)

    if (resolvedTrades.length === 0) {
      return {
        omega_gross: null,
        omega_net: null,
        gain_to_pain: null,
        profit_factor: null,
        total_gains: 0,
        total_losses: 0,
        total_fees: 0,
      }
    }

    // Calculate with gross P&L (before fees)
    const gainsGross = resolvedTrades
      .filter((t) => (t.pnl_gross || 0) > 0)
      .reduce((sum, t) => sum + (t.pnl_gross || 0), 0)

    const lossesGross = Math.abs(
      resolvedTrades
        .filter((t) => (t.pnl_gross || 0) <= 0)
        .reduce((sum, t) => sum + (t.pnl_gross || 0), 0)
    )

    // Calculate with net P&L (after fees)
    const gainsNet = resolvedTrades
      .filter((t) => (t.pnl_net || 0) > 0)
      .reduce((sum, t) => sum + (t.pnl_net || 0), 0)

    const lossesNet = Math.abs(
      resolvedTrades
        .filter((t) => (t.pnl_net || 0) <= 0)
        .reduce((sum, t) => sum + (t.pnl_net || 0), 0)
    )

    const totalFees = resolvedTrades.reduce((sum, t) => sum + t.fee_usd, 0)

    return {
      omega_gross: lossesGross > 0 ? gainsGross / lossesGross : Infinity,
      omega_net: lossesNet > 0 ? gainsNet / lossesNet : Infinity,
      gain_to_pain: lossesGross > 0 ? gainsGross / lossesGross : Infinity, // Same as omega_gross
      profit_factor: lossesNet > 0 ? gainsNet / lossesNet : Infinity,
      total_gains: gainsNet,
      total_losses: lossesNet,
      total_fees: totalFees,
    }
  }

  /**
   * Austin's #5-6, #12-14: Basic stats
   */
  private calculateBasicStats(trades: Trade[]) {
    const resolvedTrades = trades.filter((t) => t.pnl_net !== undefined)

    if (resolvedTrades.length === 0) {
      return {
        sortino: null,
        sharpe: null,
        net_pnl_usd: 0,
        net_pnl_pct: null,
        hit_rate: null,
        avg_win_usd: null,
        avg_loss_usd: null,
        resolved_bets: 0,
        track_record_days_metric: 0,
        bets_per_week_metric: 0,
        win_count: 0,
        loss_count: 0,
      }
    }

    // Calculate returns per trade
    const returns = resolvedTrades.map((t) => {
      const stake = t.usd_value || 1
      return ((t.pnl_net || 0) / stake) * 100 // Return as percentage
    })

    const meanReturn = this.mean(returns)
    const stdReturn = this.stddev(returns)

    // Downside returns (for Sortino)
    const downsideReturns = returns.filter((r) => r < 0)
    const downsideDeviation =
      downsideReturns.length > 0 ? this.stddev(downsideReturns) : 0

    // Win/loss stats
    const wins = resolvedTrades.filter((t) => (t.pnl_net || 0) > 0)
    const losses = resolvedTrades.filter((t) => (t.pnl_net || 0) <= 0)

    const netPnl = resolvedTrades.reduce((sum, t) => sum + (t.pnl_net || 0), 0)

    return {
      // Sharpe & Sortino (Austin #5-6)
      sortino:
        downsideDeviation > 0 ? meanReturn / downsideDeviation : null,
      sharpe: stdReturn > 0 ? meanReturn / stdReturn : null,

      // P&L (Austin #9-10)
      net_pnl_usd: netPnl,
      net_pnl_pct: null, // Would need starting bankroll

      // Win stats (Austin #12-14)
      hit_rate: wins.length / resolvedTrades.length,
      avg_win_usd:
        wins.length > 0
          ? wins.reduce((sum, t) => sum + (t.pnl_net || 0), 0) / wins.length
          : null,
      avg_loss_usd:
        losses.length > 0
          ? losses.reduce((sum, t) => sum + (t.pnl_net || 0), 0) /
            losses.length
          : null,

      // Count metrics (Austin #22-24)
      resolved_bets: resolvedTrades.length,
      track_record_days_metric: this.getTrackRecordDays(resolvedTrades),
      bets_per_week_metric: this.getBetsPerWeek(resolvedTrades),

      win_count: wins.length,
      loss_count: losses.length,
    }
  }

  /**
   * Austin's #17-20, #36-38: Risk metrics
   */
  private calculateRiskMetrics(trades: Trade[]) {
    const resolvedTrades = trades.filter((t) => t.pnl_net !== undefined)

    if (resolvedTrades.length === 0) {
      return {
        max_drawdown: null,
        avg_drawdown: null,
        time_in_drawdown_pct: null,
        ulcer_index: null,
        downside_deviation: null,
        max_single_trade_loss_pct: null,
        avg_holding_period_hours: null,
      }
    }

    // Calculate equity curve
    let equity = 0
    const equityCurve: number[] = []

    resolvedTrades
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .forEach((t) => {
        equity += t.pnl_net || 0
        equityCurve.push(equity)
      })

    // Max drawdown (Austin #17)
    let peak = equityCurve[0] || 0
    let maxDD = 0
    const drawdowns: number[] = []
    let daysInDD = 0

    equityCurve.forEach((eq) => {
      if (eq > peak) {
        peak = eq
      }
      const dd = peak > 0 ? (eq - peak) / peak : 0
      drawdowns.push(dd)

      if (dd < 0) {
        daysInDD++
      }

      if (dd < maxDD) {
        maxDD = dd
      }
    })

    // Austin #18: Average drawdown
    const avgDD =
      drawdowns.filter((dd) => dd < 0).length > 0
        ? this.mean(drawdowns.filter((dd) => dd < 0))
        : null

    // Austin #19: Time in drawdown
    const timeInDD =
      equityCurve.length > 0 ? daysInDD / equityCurve.length : null

    // Austin #20: Ulcer Index
    const ulcerIndex =
      drawdowns.length > 0
        ? Math.sqrt(
            drawdowns.reduce((sum, dd) => sum + dd * dd, 0) / drawdowns.length
          )
        : null

    // Austin #36: Downside deviation
    const returns = resolvedTrades.map((t) => {
      const stake = t.usd_value || 1
      return ((t.pnl_net || 0) / stake) * 100
    })
    const downsideReturns = returns.filter((r) => r < 0)
    const downsideDeviation =
      downsideReturns.length > 0 ? this.stddev(downsideReturns) : null

    // Austin #38: Max single trade loss %
    const maxLoss = Math.min(
      ...resolvedTrades.map((t) => t.pnl_net || 0)
    )
    const maxLossPct =
      trades[0]?.bankroll_at_entry && trades[0].bankroll_at_entry > 0
        ? Math.abs(maxLoss / trades[0].bankroll_at_entry) * 100
        : null

    // Austin #39: Average holding period
    const holdingPeriods = resolvedTrades
      .filter((t) => t.hours_held !== undefined)
      .map((t) => t.hours_held!)
    const avgHoldingPeriod =
      holdingPeriods.length > 0 ? this.mean(holdingPeriods) : null

    return {
      max_drawdown: maxDD,
      avg_drawdown: avgDD,
      time_in_drawdown_pct: timeInDD,
      ulcer_index: ulcerIndex,
      downside_deviation: downsideDeviation,
      max_single_trade_loss_pct: maxLossPct,
      avg_holding_period_hours: avgHoldingPeriod,
    }
  }

  /**
   * Austin's #43-44, #98: Behavioral metrics
   */
  private calculateBehavioralMetrics(trades: Trade[]) {
    if (trades.length === 0) {
      return {
        concentration_hhi: null,
        stake_sizing_volatility: null,
        yes_no_bias_count_pct: null,
        yes_no_bias_notional_pct: null,
      }
    }

    // Austin #43: Concentration (HHI)
    const marketShares = new Map<string, number>()
    let totalNotional = 0

    trades.forEach((t) => {
      const current = marketShares.get(t.market_id) || 0
      marketShares.set(t.market_id, current + t.usd_value)
      totalNotional += t.usd_value
    })

    const hhi = Array.from(marketShares.values()).reduce((sum, notional) => {
      const share = notional / totalNotional
      return sum + share * share
    }, 0)

    // Austin #44: Stake sizing volatility
    const stakeSizes = trades
      .filter((t) => t.bankroll_at_entry && t.bankroll_at_entry > 0)
      .map((t) => (t.usd_value / t.bankroll_at_entry!) * 100)
    const stakeSizingVol =
      stakeSizes.length > 0 ? this.stddev(stakeSizes) : null

    // Austin #98: YES/NO bias
    const yesCount = trades.filter((t) => t.side === 'YES').length
    const noCount = trades.filter((t) => t.side === 'NO').length
    const yesNotional = trades
      .filter((t) => t.side === 'YES')
      .reduce((sum, t) => sum + t.usd_value, 0)
    const noNotional = trades
      .filter((t) => t.side === 'NO')
      .reduce((sum, t) => sum + t.usd_value, 0)

    const totalCount = yesCount + noCount
    const totalNot = yesNotional + noNotional

    return {
      concentration_hhi: hhi,
      stake_sizing_volatility: stakeSizingVol,
      yes_no_bias_count_pct:
        totalCount > 0
          ? ((yesCount / totalCount - noCount / totalCount) * 100)
          : null,
      yes_no_bias_notional_pct:
        totalNot > 0
          ? ((yesNotional / totalNot - noNotional / totalNot) * 100)
          : null,
    }
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  private filterToWindow(trades: Trade[], window: MetricWindow): Trade[] {
    if (window.window === 'lifetime') {
      return trades
    }

    const days =
      window.window === '30d' ? 30 : window.window === '90d' ? 90 : 180
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    return trades.filter((t) => t.timestamp >= cutoff)
  }

  private getTrackRecordDays(trades: Trade[]): number {
    if (trades.length === 0) return 0

    const sorted = [...trades].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    )
    const first = sorted[0].timestamp
    const last = sorted[sorted.length - 1].timestamp

    const diffMs = last.getTime() - first.getTime()
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  }

  private getBetsPerWeek(trades: Trade[]): number {
    const days = this.getTrackRecordDays(trades)
    if (days === 0) return 0

    const weeks = days / 7
    return trades.length / weeks
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  private stddev(values: number[]): number {
    if (values.length === 0) return 0
    const avg = this.mean(values)
    const squareDiffs = values.map((v) => (v - avg) ** 2)
    return Math.sqrt(this.mean(squareDiffs))
  }

  private emptyMetrics(window: MetricWindow['window']): Phase1Metrics {
    return {
      window,
      calculated_at: new Date(),
      total_trades: 0,
      resolved_trades: 0,
      track_record_days: 0,
      bets_per_week: 0,
      omega_gross: null,
      omega_net: null,
      gain_to_pain: null,
      profit_factor: null,
      sortino: null,
      sharpe: null,
      net_pnl_usd: 0,
      net_pnl_pct: null,
      hit_rate: null,
      avg_win_usd: null,
      avg_loss_usd: null,
      max_drawdown: null,
      avg_drawdown: null,
      time_in_drawdown_pct: null,
      ulcer_index: null,
      resolved_bets: 0,
      track_record_days_metric: 0,
      bets_per_week_metric: 0,
      downside_deviation: null,
      max_single_trade_loss_pct: null,
      avg_holding_period_hours: null,
      concentration_hhi: null,
      stake_sizing_volatility: null,
      yes_no_bias_count_pct: null,
      yes_no_bias_notional_pct: null,
      total_gains: 0,
      total_losses: 0,
      total_fees: 0,
      win_count: 0,
      loss_count: 0,
    }
  }
}
