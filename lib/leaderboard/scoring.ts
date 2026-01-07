/**
 * Copy Trading Leaderboard Scoring
 *
 * Score = μ × M
 * Where:
 *   μ = mean(R_i)        - Average return per trade (positive = profitable)
 *   M = median(|R_i|)    - Typical move size (filters out arbers/market makers)
 *   R_i = positionPnl / costBasis (decimal, e.g., 0.12 = +12%)
 *
 * Why this works:
 * - Arbers/MMs have tiny % returns per trade → low M → low score
 * - Good directional traders have bigger moves → higher M → higher score
 * - Equal weight ($1/trade) means every trade counts equally
 */

import { CCRMetrics } from '../pnl/ccrEngineV1';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletScore {
  wallet: string;
  mu: number;             // Mean return per trade (decimal)
  M: number;              // Median absolute return (typical move size)
  score: number;          // μ × M
  num_trades: number;     // Number of resolved positions
  num_markets: number;    // Unique condition_ids
  win_rate: number;       // From CCR-v1
  realized_pnl: number;   // For reference (not used in scoring)
  edge_ratio: number;     // From CCR-v1
}

export interface ScoringFilters {
  min_trades: number;     // Default: 15
  min_markets: number;    // Default: 10
  require_positive_mu: boolean; // Default: true
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Calculate mean of an array
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate median of an array
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// -----------------------------------------------------------------------------
// Core Scoring Functions
// -----------------------------------------------------------------------------

/**
 * Calculate Score = μ × M from position returns
 */
export function calculateScore(returns: number[]): { mu: number; M: number; score: number } {
  if (returns.length === 0) {
    return { mu: 0, M: 0, score: 0 };
  }

  const mu = mean(returns);
  const M = median(returns.map(Math.abs));
  const score = mu * M;

  return {
    mu: Math.round(mu * 10000) / 10000,
    M: Math.round(M * 10000) / 10000,
    score: Math.round(score * 10000) / 10000,
  };
}

/**
 * Convert CCR-v1 metrics to WalletScore
 */
export function ccrToWalletScore(metrics: CCRMetrics): WalletScore {
  const { mu, M, score } = calculateScore(metrics.position_returns);

  return {
    wallet: metrics.wallet,
    mu,
    M,
    score,
    num_trades: metrics.position_returns.length,
    num_markets: metrics.resolved_count, // Approximation (positions ≈ markets for most wallets)
    win_rate: metrics.win_rate,
    realized_pnl: metrics.realized_pnl,
    edge_ratio: metrics.edge_ratio,
  };
}

/**
 * Check if wallet passes eligibility filters
 */
export function passesFilters(
  score: WalletScore,
  filters: ScoringFilters = { min_trades: 15, min_markets: 10, require_positive_mu: true }
): boolean {
  if (score.num_trades < filters.min_trades) return false;
  if (score.num_markets < filters.min_markets) return false;
  if (filters.require_positive_mu && score.mu <= 0) return false;
  return true;
}

/**
 * Rank wallets by score and apply filters
 */
export function rankWallets(
  scores: WalletScore[],
  filters: ScoringFilters = { min_trades: 15, min_markets: 10, require_positive_mu: true },
  top: number = 20
): WalletScore[] {
  return scores
    .filter(s => passesFilters(s, filters))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

// -----------------------------------------------------------------------------
// Batch Processing
// -----------------------------------------------------------------------------

/**
 * Process multiple wallets and return ranked scores
 */
export async function scoreWallets(
  wallets: string[],
  computeCCRv1: (wallet: string) => Promise<CCRMetrics>,
  filters?: ScoringFilters,
  top?: number
): Promise<WalletScore[]> {
  const scores: WalletScore[] = [];

  for (const wallet of wallets) {
    try {
      const metrics = await computeCCRv1(wallet);
      const score = ccrToWalletScore(metrics);
      scores.push(score);
    } catch (error) {
      console.error(`Error scoring wallet ${wallet}:`, error);
    }
  }

  return rankWallets(scores, filters, top);
}
