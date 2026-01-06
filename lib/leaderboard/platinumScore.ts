/**
 * Platinum Wallet Scoring Formula
 *
 * Core Formula (Expected Value):
 *   EV = (win_rate × median_win) + ((1 - win_rate) × median_loss)
 *
 * Daily Expected Return:
 *   Daily_EV = EV × (positions / age_days)
 *
 * This formula directly answers: "What's my expected return per $1 flat bet?"
 * and scales by trading frequency to find wallets with high daily alpha.
 *
 * Why EV is better than μ × M for copy trading:
 * 1. Direct interpretation: EV IS your expected return per bet
 * 2. Uses medians (robust to outliers, unlike mean)
 * 3. Properly weights by win probability
 * 4. Separates win magnitude from loss magnitude
 *
 * Uses CCR-v1 position_returns as input.
 */

import { CCRMetrics, computeCCRv1 } from '../pnl/ccrEngineV1';
import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PlatinumScore {
  wallet: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIMARY SCORES (all based on $1 per trade copy trading)
  // ═══════════════════════════════════════════════════════════════════════════
  ev_per_position: number;    // Expected $ profit per $1 trade (e.g., 0.28 = +$0.28)
  risk_adjusted_roi: number;  // EV / |median_loss| - return per unit of risk (per position)
  risk_adjusted_roi_per_day: number;  // daily_ev / |median_loss| - risk-adjusted return per day
  daily_ev: number;           // Expected $ profit per day (EV × positions/day)
  cumulative_ev: number;      // Total expected $ profit (EV × total_positions)
  copy_roi: number;           // ROI if copying with $1/trade = EV (same as ev_per_position)

  // EV Components
  win_rate: number;           // wins / total
  median_win: number;         // median win return (decimal, e.g., 0.50 = +50%)
  median_loss: number;        // median loss return (decimal, e.g., -0.30 = -30%)

  // Age & Activity
  age_days: number;           // days since first trade
  active_days: number;        // days between first and last trade
  first_trade: string;        // ISO date
  last_trade: string;         // ISO date
  positions_per_day: number;  // num_positions / age_days

  // Volume
  num_positions: number;
  num_wins: number;
  num_losses: number;
  total_trades: number;

  // Financial (actual wallet performance, not copy trading)
  realized_pnl: number;       // Wallet's actual USD PnL
  roi_per_day: number;        // Wallet's actual pnl / age_days

  // Legacy comparison
  mu: number;                 // mean(returns) - old formula component
  M: number;                  // median(|returns|) - old formula component
  mu_times_M: number;         // Old copytrade score for comparison

  // Quality
  eligible: boolean;
  reason?: string;
  is_platinum: boolean;       // Passes all quality filters
}

// -----------------------------------------------------------------------------
// Eligibility Thresholds
// -----------------------------------------------------------------------------

const MIN_AGE_DAYS = 7;           // At least 1 week old
const MIN_POSITIONS = 10;         // At least 10 resolved positions
const MIN_TRADES = 15;            // At least 15 trades
const MIN_WIN_RATE = 0.15;        // At least 15% win rate
const MIN_WINS = 3;               // At least 3 wins

// Platinum thresholds (stricter)
const PLATINUM_MIN_EV = 0.05;     // At least 5% expected return per position
const PLATINUM_MIN_AGE = 14;      // At least 2 weeks old
const PLATINUM_MIN_POSITIONS = 15;

// -----------------------------------------------------------------------------
// Helper: Calculate median
// -----------------------------------------------------------------------------

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// -----------------------------------------------------------------------------
// Get wallet age from ClickHouse
// -----------------------------------------------------------------------------

interface WalletAge {
  age_days: number;
  active_days: number;
  first_trade: string;
  last_trade: string;
}

async function getWalletAge(wallet: string): Promise<WalletAge | null> {
  const query = `
    SELECT
      min(trade_time) as first_trade,
      max(trade_time) as last_trade,
      dateDiff('day', min(trade_time), now()) as age_days,
      dateDiff('day', min(trade_time), max(trade_time)) as active_days
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}'
      AND is_deleted = 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0 || !rows[0].first_trade) return null;

  return {
    age_days: Number(rows[0].age_days) || 1,  // Avoid division by zero
    active_days: Number(rows[0].active_days) || 1,
    first_trade: rows[0].first_trade,
    last_trade: rows[0].last_trade,
  };
}

// -----------------------------------------------------------------------------
// Scoring Implementation
// -----------------------------------------------------------------------------

/**
 * Calculate platinum score from CCR-v1 metrics + wallet age
 */
export function calculatePlatinumScore(
  metrics: CCRMetrics,
  age: WalletAge
): PlatinumScore {
  const {
    wallet,
    position_returns,
    total_trades,
    positions_count,
    win_count,
    loss_count,
    realized_pnl,
  } = metrics;

  const N = position_returns.length;

  // Base result for ineligible wallets
  const baseResult: PlatinumScore = {
    wallet,
    ev_per_position: 0,
    risk_adjusted_roi: 0,
    risk_adjusted_roi_per_day: 0,
    daily_ev: 0,
    cumulative_ev: 0,
    copy_roi: 0,
    win_rate: 0,
    median_win: 0,
    median_loss: 0,
    age_days: age.age_days,
    active_days: age.active_days,
    first_trade: age.first_trade,
    last_trade: age.last_trade,
    positions_per_day: 0,
    num_positions: N,
    num_wins: win_count,
    num_losses: loss_count,
    total_trades,
    realized_pnl,
    roi_per_day: 0,
    mu: 0,
    M: 0,
    mu_times_M: 0,
    eligible: false,
    is_platinum: false,
  };

  // Eligibility checks
  if (age.age_days < MIN_AGE_DAYS) {
    return { ...baseResult, reason: `Too young: ${age.age_days} < ${MIN_AGE_DAYS} days` };
  }

  if (N < MIN_POSITIONS) {
    return { ...baseResult, reason: `Insufficient positions: ${N} < ${MIN_POSITIONS}` };
  }

  if (total_trades < MIN_TRADES) {
    return { ...baseResult, reason: `Insufficient trades: ${total_trades} < ${MIN_TRADES}` };
  }

  // Separate wins and losses
  const wins = position_returns.filter(r => r > 0);
  const losses = position_returns.filter(r => r < 0);

  const win_rate = N > 0 ? wins.length / N : 0;

  if (win_rate < MIN_WIN_RATE) {
    return { ...baseResult, reason: `Win rate too low: ${(win_rate * 100).toFixed(1)}% < ${MIN_WIN_RATE * 100}%` };
  }

  if (wins.length < MIN_WINS) {
    return { ...baseResult, reason: `Insufficient wins: ${wins.length} < ${MIN_WINS}` };
  }

  // Calculate medians
  const median_win = median(wins);      // Positive decimal
  const median_loss = median(losses);   // Negative decimal

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE FORMULA 1: Expected Value (EV)
  // EV = (win_rate × median_win) + ((1 - win_rate) × median_loss)
  // Interpretation: Expected $ profit per $1 bet
  // ═══════════════════════════════════════════════════════════════════════════
  const ev_per_position = (win_rate * median_win) + ((1 - win_rate) * median_loss);

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE FORMULA 2: Risk-Adjusted ROI (per position)
  // ROI = EV / |median_loss|
  // Interpretation: Expected return per unit of typical risk
  // Rewards wallets with asymmetric payoffs (small losses, big wins)
  // ═══════════════════════════════════════════════════════════════════════════
  const risk_adjusted_roi = median_loss !== 0
    ? ev_per_position / Math.abs(median_loss)
    : ev_per_position > 0 ? Infinity : 0;

  // Activity metrics
  const positions_per_day = N / age.age_days;

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE FORMULA 3: Risk-Adjusted ROI per Day
  // ROI/day = daily_ev / |median_loss|
  // Interpretation: Risk-adjusted expected return per day
  // Combines trading frequency with risk efficiency
  // ═══════════════════════════════════════════════════════════════════════════
  const daily_ev_raw = ev_per_position * positions_per_day;
  const risk_adjusted_roi_per_day = median_loss !== 0
    ? daily_ev_raw / Math.abs(median_loss)
    : daily_ev_raw > 0 ? Infinity : 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // DAILY EV: Expected $ profit per day if copy trading with $1/trade
  // Daily_EV = EV × positions_per_day
  // ═══════════════════════════════════════════════════════════════════════════
  const daily_ev = ev_per_position * positions_per_day;

  // ═══════════════════════════════════════════════════════════════════════════
  // CUMULATIVE EV: Total expected $ profit over wallet's lifetime
  // If you had copied every trade with $1, what would you have made?
  // ═══════════════════════════════════════════════════════════════════════════
  const cumulative_ev = ev_per_position * N;

  // Copy trading ROI = EV (since capital = $1 × positions, return = EV × positions)
  const copy_roi = ev_per_position;

  // ROI per day (actual realized by the wallet, not copy trading)
  const roi_per_day = realized_pnl / age.age_days;

  // Legacy metrics for comparison
  const mu = position_returns.reduce((a, b) => a + b, 0) / N;
  const absReturns = position_returns.map(r => Math.abs(r));
  const M = median(absReturns);
  const mu_times_M = mu * M;

  // Platinum qualification
  const is_platinum =
    ev_per_position >= PLATINUM_MIN_EV &&
    age.age_days >= PLATINUM_MIN_AGE &&
    N >= PLATINUM_MIN_POSITIONS &&
    wins.length >= MIN_WINS;

  return {
    wallet,
    ev_per_position: Math.round(ev_per_position * 10000) / 10000,
    risk_adjusted_roi: Math.round(risk_adjusted_roi * 10000) / 10000,
    risk_adjusted_roi_per_day: Math.round(risk_adjusted_roi_per_day * 10000) / 10000,
    daily_ev: Math.round(daily_ev * 10000) / 10000,
    cumulative_ev: Math.round(cumulative_ev * 100) / 100,
    copy_roi: Math.round(copy_roi * 10000) / 10000,
    win_rate: Math.round(win_rate * 1000) / 1000,
    median_win: Math.round(median_win * 10000) / 10000,
    median_loss: Math.round(median_loss * 10000) / 10000,
    age_days: age.age_days,
    active_days: age.active_days,
    first_trade: age.first_trade,
    last_trade: age.last_trade,
    positions_per_day: Math.round(positions_per_day * 100) / 100,
    num_positions: N,
    num_wins: wins.length,
    num_losses: losses.length,
    total_trades,
    realized_pnl: Math.round(realized_pnl * 100) / 100,
    roi_per_day: Math.round(roi_per_day * 100) / 100,
    mu: Math.round(mu * 10000) / 10000,
    M: Math.round(M * 10000) / 10000,
    mu_times_M: Math.round(mu_times_M * 100000) / 100000,
    eligible: true,
    is_platinum,
  };
}

/**
 * Compute platinum score for a wallet (end-to-end)
 */
export async function computePlatinumScore(wallet: string): Promise<PlatinumScore> {
  // Get age first
  const age = await getWalletAge(wallet);
  if (!age) {
    return {
      wallet,
      ev_per_position: 0,
      risk_adjusted_roi: 0,
      risk_adjusted_roi_per_day: 0,
      daily_ev: 0,
      cumulative_ev: 0,
      copy_roi: 0,
      win_rate: 0,
      median_win: 0,
      median_loss: 0,
      age_days: 0,
      active_days: 0,
      first_trade: '',
      last_trade: '',
      positions_per_day: 0,
      num_positions: 0,
      num_wins: 0,
      num_losses: 0,
      total_trades: 0,
      realized_pnl: 0,
      roi_per_day: 0,
      mu: 0,
      M: 0,
      mu_times_M: 0,
      eligible: false,
      reason: 'No trades found',
      is_platinum: false,
    };
  }

  const metrics = await computeCCRv1(wallet);
  return calculatePlatinumScore(metrics, age);
}

/**
 * Rank multiple wallets by platinum score (daily_ev)
 */
export async function rankPlatinumWallets(
  wallets: string[],
  options?: {
    onProgress?: (completed: number, total: number, wallet: string) => void;
    timeoutMs?: number;
  }
): Promise<PlatinumScore[]> {
  const scores: PlatinumScore[] = [];
  const timeoutMs = options?.timeoutMs ?? 60000;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    try {
      // Wrap with timeout
      const scorePromise = computePlatinumScore(wallet);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      );

      const score = await Promise.race([scorePromise, timeoutPromise]);
      scores.push(score);

      options?.onProgress?.(i + 1, wallets.length, wallet);
    } catch (e: any) {
      // Create error entry
      scores.push({
        wallet,
        ev_per_position: 0,
        risk_adjusted_roi: 0,
        risk_adjusted_roi_per_day: 0,
        daily_ev: 0,
        cumulative_ev: 0,
        copy_roi: 0,
        win_rate: 0,
        median_win: 0,
        median_loss: 0,
        age_days: 0,
        active_days: 0,
        first_trade: '',
        last_trade: '',
        positions_per_day: 0,
        num_positions: 0,
        num_wins: 0,
        num_losses: 0,
        total_trades: 0,
        realized_pnl: 0,
        roi_per_day: 0,
        mu: 0,
        M: 0,
        mu_times_M: 0,
        eligible: false,
        reason: `Error: ${e.message?.slice(0, 50)}`,
        is_platinum: false,
      });

      options?.onProgress?.(i + 1, wallets.length, wallet);
    }
  }

  // Sort: eligible first, then platinum, then by daily_ev descending
  return scores.sort((a, b) => {
    if (a.eligible && !b.eligible) return -1;
    if (!a.eligible && b.eligible) return 1;
    if (a.is_platinum && !b.is_platinum) return -1;
    if (!a.is_platinum && b.is_platinum) return 1;
    return b.daily_ev - a.daily_ev;
  });
}
