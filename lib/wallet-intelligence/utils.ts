/**
 * Wallet Intelligence Utility Functions
 * Core mathematical helpers for position and metric calculations
 */

import type { MarketSide } from './types';

// ============ Side Space Conversion ============

/**
 * Convert a YES price to "side space" price
 * If side is YES: p_side = p_yes
 * If side is NO: p_side = 1 - p_yes
 */
export function toSideSpace(side: MarketSide, pYes: number): number {
  const p = clamp01(pYes);
  return side === 'YES' ? p : clamp01(1 - p);
}

/**
 * Convert outcome (0/1 for YES) to "side space"
 */
export function outcomeToSideSpace(side: MarketSide, outcomeYes: 0 | 1): 0 | 1 {
  if (side === 'YES') return outcomeYes;
  return (1 - outcomeYes) as 0 | 1;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ============ PnL & ROI ============

export function positionPnl(costUsd: number, proceedsUsd: number): number {
  return proceedsUsd - costUsd;
}

export function positionRoi(costUsd: number, pnlUsd: number): number {
  if (costUsd <= 0) return 0;
  return pnlUsd / costUsd;
}

// ============ CLV (Closing Line Value) ============

/**
 * CLV = p_close - p_entry (both in side space)
 * Positive CLV means trader got a better price than the closing line
 */
export function clv(pEntrySide: number, pCloseSide: number): number {
  return pCloseSide - pEntrySide;
}

export function clvWinRate(clvValues: number[]): number {
  if (!clvValues.length) return 0;
  return clvValues.filter(x => x > 0).length / clvValues.length;
}

// ============ Statistics ============

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

export function downsideDeviation(xs: number[], threshold = 0): number {
  const below = xs.filter(x => x < threshold).map(x => (x - threshold) ** 2);
  if (!below.length) return 0;
  return Math.sqrt(mean(below));
}

// ============ HHI (Herfindahl-Hirschman Index) ============

/**
 * HHI measures concentration
 * 0 = perfectly diversified, 1 = all in one bucket
 */
export function hhiFromCounts(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let hhi = 0;
  for (const c of counts) {
    const s = c / total;
    hhi += s * s;
  }
  return hhi;
}

export function topShare(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const max = Math.max(...counts);
  return max / total;
}

// ============ Drawdown ============

export interface PnlPoint {
  t: number; // timestamp ms
  pnlUsd: number;
}

export function maxDrawdown(points: PnlPoint[]): { maxDdUsd: number; maxDdPct: number } {
  if (!points.length) return { maxDdUsd: 0, maxDdPct: 0 };

  const sorted = [...points].sort((a, b) => a.t - b.t);
  let equity = 0;
  let peak = 0;
  let maxDdUsd = 0;
  let maxDdPct = 0;

  for (const p of sorted) {
    equity += p.pnlUsd;
    if (equity > peak) {
      peak = equity;
    }
    const dd = peak - equity;
    if (dd > maxDdUsd) {
      maxDdUsd = dd;
      maxDdPct = peak > 0 ? dd / peak : 0;
    }
  }
  return { maxDdUsd, maxDdPct };
}

// ============ Risk Metrics ============

export function varAtPercentile(rois: number[], p: number): number {
  // VaR is the loss at the p-th percentile (negative)
  return percentile(rois, p);
}

export function cvarAtPercentile(rois: number[], p: number): number {
  // CVaR (Expected Shortfall) is the average of losses below VaR
  const threshold = varAtPercentile(rois, p);
  const below = rois.filter(r => r <= threshold);
  return mean(below);
}

export function sortinoRatio(rois: number[], riskFreeRate = 0): number {
  const excessReturns = rois.map(r => r - riskFreeRate);
  const avgExcess = mean(excessReturns);
  const downDev = downsideDeviation(rois, riskFreeRate);
  if (downDev === 0) return 0;
  return avgExcess / downDev;
}

// ============ Payoff Metrics ============

export function expectancy(winRate: number, avgWin: number, avgLoss: number): number {
  return winRate * avgWin + (1 - winRate) * avgLoss;
}

export function payoffRatio(avgWin: number, avgLoss: number): number {
  if (avgLoss === 0) return 0;
  return avgWin / Math.abs(avgLoss);
}

export function shrinkExpectancy(E: number, N: number, K = 100): number {
  const w = N / (N + K);
  return w * E;
}

// ============ Forecasting Quality ============

export function brierScore(p: number, y: 0 | 1): number {
  const e = p - y;
  return e * e;
}

export function logLoss(p: number, y: 0 | 1): number {
  const eps = 1e-12;
  const pp = Math.min(1 - eps, Math.max(eps, p));
  return -(y * Math.log(pp) + (1 - y) * Math.log(1 - pp));
}

export function sharpness(prices: number[]): number {
  // Average absolute deviation from 0.5
  return mean(prices.map(p => Math.abs(p - 0.5)));
}
