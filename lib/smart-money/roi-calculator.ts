/**
 * Smart Money ROI Calculator
 *
 * Functions for calculating ROI, expected value, and Kelly fraction
 * for smart money signals.
 */

import { TradeResult, SignalAction } from "./types";

/**
 * Calculate ROI for a single trade.
 *
 * @param trade - The trade result (action, entry price, outcome)
 * @returns ROI as a decimal (e.g., 0.5 = +50%, -1 = -100%)
 */
export function calculateROI(trade: TradeResult): number {
  const won =
    (trade.action === "BET_YES" && trade.outcome === 1) ||
    (trade.action === "BET_NO" && trade.outcome === 0);

  if (won) {
    // Payout is $1, cost is entry_price
    // ROI = (payout - cost) / cost = (1 / entry_price) - 1
    return 1 / trade.entry_price - 1;
  } else {
    // Lost entire stake
    return -1;
  }
}

/**
 * Determine if a trade was a win.
 */
export function isWin(trade: TradeResult): boolean {
  return (
    (trade.action === "BET_YES" && trade.outcome === 1) ||
    (trade.action === "BET_NO" && trade.outcome === 0)
  );
}

/**
 * Calculate expected value (EV) per dollar bet.
 *
 * @param win_rate - Probability of winning (0-1)
 * @param entry_price - Price paid to enter (0-1)
 * @returns Expected value as decimal (e.g., 0.2 = +20% EV)
 */
export function calculateExpectedValue(
  win_rate: number,
  entry_price: number
): number {
  // EV = P(win) * profit_if_win + P(lose) * loss_if_lose
  // profit_if_win = (1 / entry_price) - 1
  // loss_if_lose = -1 (lose entire stake)
  const profit_if_win = 1 / entry_price - 1;
  const loss_if_lose = -1;

  return win_rate * profit_if_win + (1 - win_rate) * loss_if_lose;
}

/**
 * Calculate expected ROI percentage.
 */
export function calculateExpectedROI(
  win_rate: number,
  entry_price: number
): number {
  return calculateExpectedValue(win_rate, entry_price);
}

/**
 * Calculate Kelly Criterion fraction for optimal bet sizing.
 *
 * Kelly = (bp - q) / b
 * where:
 *   b = odds received (payout ratio - 1)
 *   p = probability of winning
 *   q = probability of losing (1 - p)
 *
 * @param win_rate - Probability of winning (0-1)
 * @param entry_price - Price paid to enter (0-1)
 * @param max_fraction - Maximum fraction to return (default 0.25 = 25%)
 * @returns Optimal bet fraction (0 to max_fraction)
 */
export function calculateKellyFraction(
  win_rate: number,
  entry_price: number,
  max_fraction: number = 0.25
): number {
  // b = odds = (payout / stake) - 1 = (1 / entry_price) - 1
  const b = 1 / entry_price - 1;
  const p = win_rate;
  const q = 1 - win_rate;

  // Kelly formula: (bp - q) / b
  const kelly = (b * p - q) / b;

  // Clamp to [0, max_fraction]
  return Math.max(0, Math.min(kelly, max_fraction));
}

/**
 * Calculate half-Kelly fraction (more conservative).
 */
export function calculateHalfKelly(
  win_rate: number,
  entry_price: number
): number {
  return calculateKellyFraction(win_rate, entry_price) / 2;
}

/**
 * Calculate quarter-Kelly fraction (conservative).
 */
export function calculateQuarterKelly(
  win_rate: number,
  entry_price: number
): number {
  return calculateKellyFraction(win_rate, entry_price) / 4;
}

/**
 * Calculate recommended position size in USD.
 *
 * @param bankroll - Total bankroll in USD
 * @param win_rate - Probability of winning (0-1)
 * @param entry_price - Price paid to enter (0-1)
 * @param kelly_divisor - Divisor for Kelly (1 = full, 2 = half, 4 = quarter)
 * @returns Recommended position size in USD
 */
export function calculatePositionSize(
  bankroll: number,
  win_rate: number,
  entry_price: number,
  kelly_divisor: number = 4
): number {
  const kelly = calculateKellyFraction(win_rate, entry_price);
  const fraction = kelly / kelly_divisor;
  return bankroll * fraction;
}

/**
 * Calculate statistics for a batch of trades.
 */
export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_roi: number;
  avg_roi: number;
  max_win: number;
  max_loss: number;
  profit_factor: number;
  sharpe_ratio: number;
}

export function calculateTradeStats(trades: TradeResult[]): TradeStats {
  if (trades.length === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      total_roi: 0,
      avg_roi: 0,
      max_win: 0,
      max_loss: 0,
      profit_factor: 0,
      sharpe_ratio: 0,
    };
  }

  const rois = trades.map((t) => calculateROI(t));
  const wins = rois.filter((r) => r > 0);
  const losses = rois.filter((r) => r < 0);

  const total_roi = rois.reduce((sum, r) => sum + r, 0);
  const avg_roi = total_roi / trades.length;

  // Calculate standard deviation for Sharpe ratio
  const variance =
    rois.reduce((sum, r) => sum + Math.pow(r - avg_roi, 2), 0) / trades.length;
  const std_dev = Math.sqrt(variance);

  // Sharpe ratio (assuming risk-free rate = 0)
  const sharpe_ratio = std_dev > 0 ? avg_roi / std_dev : 0;

  // Profit factor = gross wins / gross losses
  const gross_wins = wins.reduce((sum, r) => sum + r, 0);
  const gross_losses = Math.abs(losses.reduce((sum, r) => sum + r, 0));
  const profit_factor = gross_losses > 0 ? gross_wins / gross_losses : 0;

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: wins.length / trades.length,
    total_roi,
    avg_roi,
    max_win: wins.length > 0 ? Math.max(...wins) : 0,
    max_loss: losses.length > 0 ? Math.min(...losses) : 0,
    profit_factor,
    sharpe_ratio,
  };
}

/**
 * Calculate maximum drawdown from a series of trade results.
 *
 * @param trades - Array of trade results in chronological order
 * @returns Maximum drawdown as a decimal (e.g., 0.2 = 20% drawdown)
 */
export function calculateMaxDrawdown(trades: TradeResult[]): number {
  if (trades.length === 0) return 0;

  let peak = 1; // Start with $1
  let maxDrawdown = 0;
  let current = 1;

  for (const trade of trades) {
    const roi = calculateROI(trade);
    current = current * (1 + roi);

    if (current > peak) {
      peak = current;
    }

    const drawdown = (peak - current) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

/**
 * Simulate equity curve from trades.
 *
 * @param trades - Array of trade results in chronological order
 * @param starting_bankroll - Starting bankroll (default $1000)
 * @returns Array of equity values after each trade
 */
export function simulateEquityCurve(
  trades: TradeResult[],
  starting_bankroll: number = 1000
): number[] {
  const curve: number[] = [starting_bankroll];
  let current = starting_bankroll;

  for (const trade of trades) {
    const roi = calculateROI(trade);
    current = current * (1 + roi);
    curve.push(current);
  }

  return curve;
}
