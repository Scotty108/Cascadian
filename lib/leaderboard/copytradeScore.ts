/**
 * Copytrade Scoring Formula
 *
 * Score = μ × M
 *
 * Where:
 * - μ = mean(R_i) = average per-position return (decimal)
 * - M = median(|R_i|) = typical move size (absolute value)
 *
 * This finds "repeatable forecasters + directional traders" and suppresses:
 * - Arbs/micro-edge (tiny M)
 * - One-hit wonders (low win count, single jackpot)
 * - Gamblers (large median losses)
 *
 * Secondary metrics for filtering:
 * - Median Win % vs Median Loss %
 * - Win Rate
 * - Win/Loss Ratio (|median win| / |median loss|)
 *
 * Uses CCR-v1 position_returns as input.
 */

import { CCRMetrics, computeCCRv1 } from '../pnl/ccrEngineV1';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface CopytradeScore {
  wallet: string;
  score: number;
  eligible: boolean;
  reason?: string;

  // Eligibility inputs
  numTrades: number;
  numMarkets: number;

  // Primary scoring components
  mu: number;              // mean(R_i) - average return
  M: number;               // median(|R_i|) - typical move size

  // Secondary metrics
  medianWinPct: number;    // median of wins (decimal, e.g., 0.15 = +15%)
  medianLossPct: number;   // median of losses (negative decimal, e.g., -0.08)
  winLossRatio: number;    // |medianWin| / |medianLoss| (>1 = good)
  winRate: number;         // wins / total

  // Counts
  numPositions: number;
  numWins: number;
  numLosses: number;

  // Quality flags
  isCopyable: boolean;     // passes secondary filters

  // Financial
  realizedPnl: number;     // Total USD PnL
}

// -----------------------------------------------------------------------------
// Eligibility Thresholds
// -----------------------------------------------------------------------------

const MIN_TRADES = 20;
const MIN_MARKETS = 10;
const MIN_POSITIONS = 10;

// Copyability thresholds
const MIN_WIN_RATE = 0.20;           // At least 20% win rate
const MIN_WINS = 5;                  // At least 5 winning positions
const MIN_WIN_LOSS_RATIO = 0.8;      // Median win should be >= 80% of |median loss|

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
// Scoring Implementation
// -----------------------------------------------------------------------------

/**
 * Calculate copytrade score from CCR-v1 metrics
 */
export function calculateCopytradeScore(metrics: CCRMetrics): CopytradeScore {
  const {
    wallet,
    position_returns,
    total_trades,
    positions_count,
    win_count,
    loss_count,
    realized_pnl,
  } = metrics;

  const numMarkets = positions_count;
  const numTrades = total_trades;

  // Base result for ineligible wallets
  const baseResult: CopytradeScore = {
    wallet,
    score: 0,
    eligible: false,
    numTrades,
    numMarkets,
    mu: 0,
    M: 0,
    medianWinPct: 0,
    medianLossPct: 0,
    winLossRatio: 0,
    winRate: 0,
    numPositions: position_returns.length,
    numWins: win_count,
    numLosses: loss_count,
    isCopyable: false,
    realizedPnl: realized_pnl,
  };

  // Eligibility checks
  if (numTrades < MIN_TRADES) {
    return { ...baseResult, reason: `Insufficient trades: ${numTrades} < ${MIN_TRADES}` };
  }

  if (numMarkets < MIN_MARKETS) {
    return { ...baseResult, reason: `Insufficient markets: ${numMarkets} < ${MIN_MARKETS}` };
  }

  if (position_returns.length < MIN_POSITIONS) {
    return { ...baseResult, reason: `Insufficient positions: ${position_returns.length} < ${MIN_POSITIONS}` };
  }

  const R_list = position_returns;
  const N = R_list.length;

  // Step 1: Primary Score = μ × M
  // μ = mean(R_i)
  const mu = R_list.reduce((a, b) => a + b, 0) / N;

  // M = median(|R_i|)
  const absReturns = R_list.map(r => Math.abs(r));
  const M = median(absReturns);

  // Score
  const score = mu * M;

  // Step 2: Secondary Metrics
  const wins = R_list.filter(r => r > 0);
  const losses = R_list.filter(r => r < 0);

  const medianWinPct = median(wins);
  const medianLossPct = median(losses); // Will be negative

  // Win/Loss Ratio = |median win| / |median loss|
  const winLossRatio = medianLossPct !== 0
    ? Math.abs(medianWinPct / medianLossPct)
    : medianWinPct > 0 ? Infinity : 0;

  const winRate = N > 0 ? wins.length / N : 0;

  // Copyability check
  // Good wallet has:
  // - Positive score
  // - Median win >= 80% of |median loss| (win/loss ratio >= 0.8)
  // - Win rate not too low (>= 20%)
  // - Sufficient wins (>= 5)
  // - M not tiny (move size meaningful)
  const isCopyable =
    score > 0 &&
    winLossRatio >= MIN_WIN_LOSS_RATIO &&
    winRate >= MIN_WIN_RATE &&
    wins.length >= MIN_WINS &&
    M >= 0.01; // At least 1% typical move

  return {
    wallet,
    score: Math.round(score * 100000) / 100000, // 5 decimal places
    eligible: true,
    numTrades,
    numMarkets,
    mu: Math.round(mu * 10000) / 10000,
    M: Math.round(M * 10000) / 10000,
    medianWinPct: Math.round(medianWinPct * 10000) / 10000,
    medianLossPct: Math.round(medianLossPct * 10000) / 10000,
    winLossRatio: Math.round(winLossRatio * 1000) / 1000,
    winRate: Math.round(winRate * 1000) / 1000,
    numPositions: N,
    numWins: wins.length,
    numLosses: losses.length,
    isCopyable,
    realizedPnl: realized_pnl,
  };
}

/**
 * Compute copytrade score for a wallet (end-to-end)
 */
export async function computeCopytradeScore(wallet: string): Promise<CopytradeScore> {
  const metrics = await computeCCRv1(wallet);
  return calculateCopytradeScore(metrics);
}

/**
 * Rank multiple wallets by copytrade score
 */
export async function rankCopytradeWallets(
  wallets: string[],
  options?: {
    onProgress?: (completed: number, total: number, wallet: string) => void;
    timeoutMs?: number;
  }
): Promise<CopytradeScore[]> {
  const scores: CopytradeScore[] = [];
  const timeoutMs = options?.timeoutMs ?? 60000;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    try {
      // Wrap with timeout
      const scorePromise = computeCopytradeScore(wallet);
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
        score: 0,
        eligible: false,
        reason: `Error: ${e.message?.slice(0, 50)}`,
        numTrades: 0,
        numMarkets: 0,
        mu: 0,
        M: 0,
        medianWinPct: 0,
        medianLossPct: 0,
        winLossRatio: 0,
        winRate: 0,
        numPositions: 0,
        numWins: 0,
        numLosses: 0,
        isCopyable: false,
        realizedPnl: 0,
      });

      options?.onProgress?.(i + 1, wallets.length, wallet);
    }
  }

  // Sort by score descending (eligible first, then copyable, then by score)
  return scores.sort((a, b) => {
    if (a.eligible && !b.eligible) return -1;
    if (!a.eligible && b.eligible) return 1;
    if (a.isCopyable && !b.isCopyable) return -1;
    if (!a.isCopyable && b.isCopyable) return 1;
    return b.score - a.score;
  });
}
