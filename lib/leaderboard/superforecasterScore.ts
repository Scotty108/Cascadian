/**
 * Superforecaster Scoring Formula
 *
 * Score = μ_cap × √M
 *
 * Where:
 * - μ_cap = mean return with wins capped at 95th percentile (leaves losses untouched)
 * - M = median of absolute returns (typical move size)
 *
 * Uses CCR-v1 position returns as input.
 */

import { CCRMetrics, computeCCRv1 } from '../pnl/ccrEngineV1';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SuperforecasterScore {
  wallet: string;
  score: number;
  eligible: boolean;
  reason?: string;

  // Eligibility inputs
  numTrades: number;
  numMarkets: number;

  // Scoring components
  numPositions: number;
  numWins: number;
  p95Plus: number;        // 95th percentile of wins (cap threshold)
  muRaw: number;          // Raw mean return (before capping)
  muCap: number;          // Capped mean return
  M: number;              // Median absolute return

  // Diagnostic
  winRate: number;
  avgWinPct: number;      // Average win % (before cap)
  avgLossPct: number;     // Average loss % (as positive number)
}

// -----------------------------------------------------------------------------
// Eligibility Thresholds
// -----------------------------------------------------------------------------

const MIN_TRADES = 15;
const MIN_MARKETS = 10;

// -----------------------------------------------------------------------------
// Scoring Implementation
// -----------------------------------------------------------------------------

/**
 * Calculate superforecaster score from CCR-v1 metrics
 */
export function calculateScore(metrics: CCRMetrics): SuperforecasterScore {
  const { wallet, position_returns, total_trades, positions_count, win_count, loss_count } = metrics;

  // Use positions_count as proxy for numMarkets (each position is a unique token/market)
  const numMarkets = positions_count;
  const numTrades = total_trades;

  // Base result for ineligible wallets
  const baseResult: SuperforecasterScore = {
    wallet,
    score: 0,
    eligible: false,
    numTrades,
    numMarkets,
    numPositions: position_returns.length,
    numWins: win_count,
    p95Plus: 0,
    muRaw: 0,
    muCap: 0,
    M: 0,
    winRate: 0,
    avgWinPct: 0,
    avgLossPct: 0,
  };

  // Eligibility checks
  if (numTrades < MIN_TRADES) {
    return { ...baseResult, reason: `Insufficient trades: ${numTrades} < ${MIN_TRADES}` };
  }

  if (numMarkets < MIN_MARKETS) {
    return { ...baseResult, reason: `Insufficient markets: ${numMarkets} < ${MIN_MARKETS}` };
  }

  if (position_returns.length === 0) {
    return { ...baseResult, reason: 'No resolved positions with returns' };
  }

  const R_list = position_returns;
  const N = R_list.length;

  // Step 1: Compute raw mean
  const muRaw = R_list.reduce((a, b) => a + b, 0) / N;

  // Step 2: Get wins only and compute 95th percentile cap
  const wins = R_list.filter(r => r > 0).sort((a, b) => a - b);
  const losses = R_list.filter(r => r < 0);

  let p95Plus = 0;
  if (wins.length > 0) {
    // Type 7 percentile (linear interpolation) - matches NumPy/Pandas default
    const idx = 0.95 * (wins.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const frac = idx - lower;
    p95Plus = wins[lower] + frac * ((wins[upper] ?? wins[lower]) - wins[lower]);
  }

  // Step 3: Cap wins only (leave losses untouched)
  const R_cap_list = R_list.map(r => {
    if (r > 0 && r > p95Plus) return p95Plus;
    return r;
  });

  // Step 4: Compute capped mean
  const muCap = R_cap_list.reduce((a, b) => a + b, 0) / N;

  // Step 5: Compute median absolute return (using original returns)
  const absReturns = R_list.map(r => Math.abs(r)).sort((a, b) => a - b);
  const M = absReturns.length % 2 === 0
    ? (absReturns[absReturns.length / 2 - 1] + absReturns[absReturns.length / 2]) / 2
    : absReturns[Math.floor(absReturns.length / 2)];

  // Step 6: Calculate score
  const score = muCap * Math.sqrt(M);

  // Diagnostics
  const winRate = wins.length / N;
  const avgWinPct = wins.length > 0
    ? (wins.reduce((a, b) => a + b, 0) / wins.length) * 100
    : 0;
  const avgLossPct = losses.length > 0
    ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) * 100
    : 0;

  return {
    wallet,
    score,
    eligible: true,
    numTrades,
    numMarkets,
    numPositions: N,
    numWins: wins.length,
    p95Plus,
    muRaw,
    muCap,
    M,
    winRate,
    avgWinPct,
    avgLossPct,
  };
}

/**
 * Compute superforecaster score for a wallet (end-to-end)
 */
export async function computeWalletScore(wallet: string): Promise<SuperforecasterScore> {
  const metrics = await computeCCRv1(wallet);
  return calculateScore(metrics);
}

/**
 * Rank multiple wallets by superforecaster score
 */
export async function rankWallets(wallets: string[]): Promise<SuperforecasterScore[]> {
  const scores: SuperforecasterScore[] = [];

  for (const wallet of wallets) {
    try {
      const score = await computeWalletScore(wallet);
      scores.push(score);
    } catch (e) {
      console.error(`Error scoring ${wallet}:`, e);
    }
  }

  // Sort by score descending (eligible first, then by score)
  return scores.sort((a, b) => {
    if (a.eligible && !b.eligible) return -1;
    if (!a.eligible && b.eligible) return 1;
    return b.score - a.score;
  });
}
