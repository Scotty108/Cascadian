/**
 * Copy-Trading Confidence Scoring (v1)
 *
 * Scores wallets for copy-trading readiness based on:
 * 1. Trade activity (count, recency)
 * 2. Redemption ratio (lower = more of their PnL is trackable via CLOB)
 * 3. PnL estimate (simple cash-flow)
 *
 * Key insight: High redemptions relative to trades suggest external token acquisitions
 * (transfers, splits) which our CLOB-only engine can't track accurately.
 *
 * Confidence Tiers:
 * - HIGH: redemption_ratio < 0.1 AND redemption_usdc < 2x PnL
 * - MEDIUM: redemption_ratio < 0.3 AND redemption_usdc < 5x PnL
 * - LOW: everything else
 */

export type ConfidenceTier = 'high' | 'medium' | 'low';

export interface WalletCopyTradingScore {
  wallet: string;
  tier: ConfidenceTier;
  score: number; // 0-100, higher = better
  reasons: string[];
  metrics: {
    tradeCount: number;
    trades30d: number;
    pnlEstimate: number;
    redemptionCount: number;
    redemptionUsdc: number;
    redemptionRatio: number;
  };
}

export interface CopyTradingFilter {
  minTrades?: number;
  minTrades30d?: number;
  minPnl?: number;
  minTier?: ConfidenceTier;
}

export const DEFAULT_FILTER: CopyTradingFilter = {
  minTrades: 20,
  minTrades30d: 1,
  minPnl: 500,
  minTier: 'medium',
};

/**
 * Score a wallet for copy-trading confidence.
 */
export function scoreWallet(params: {
  wallet: string;
  tradeCount: number;
  trades30d: number;
  buyUsdc: number;
  sellUsdc: number;
  buyCount: number;
  sellCount: number;
  redemptionCount: number;
  redemptionUsdc: number;
}): WalletCopyTradingScore {
  const {
    wallet,
    tradeCount,
    trades30d,
    buyUsdc,
    sellUsdc,
    redemptionCount,
    redemptionUsdc,
  } = params;

  // Simple PnL estimate: sell - buy cash flows
  const pnlEstimate = sellUsdc - buyUsdc;

  // Redemption ratio: redemption events / total trades
  const redemptionRatio = tradeCount > 0 ? redemptionCount / tradeCount : 0;

  // Determine confidence tier
  const reasons: string[] = [];
  let tier: ConfidenceTier;

  if (redemptionRatio < 0.1 && redemptionUsdc < Math.abs(pnlEstimate) * 2) {
    tier = 'high';
    reasons.push('Low redemption ratio (<10%)');
    reasons.push('Redemption USDC within 2x PnL');
  } else if (redemptionRatio < 0.3 && redemptionUsdc < Math.abs(pnlEstimate) * 5) {
    tier = 'medium';
    if (redemptionRatio >= 0.1) {
      reasons.push(`Moderate redemption ratio (${(redemptionRatio * 100).toFixed(1)}%)`);
    }
    if (redemptionUsdc >= Math.abs(pnlEstimate) * 2) {
      reasons.push('Redemption USDC between 2-5x PnL');
    }
  } else {
    tier = 'low';
    if (redemptionRatio >= 0.3) {
      reasons.push(`High redemption ratio (${(redemptionRatio * 100).toFixed(1)}%)`);
    }
    if (redemptionUsdc >= Math.abs(pnlEstimate) * 5) {
      reasons.push(`Redemption USDC > 5x PnL estimate`);
    }
  }

  // Calculate numeric score (0-100)
  let score = 50; // Base score

  // Activity bonus (up to +20)
  if (tradeCount > 100) score += 5;
  if (tradeCount > 500) score += 5;
  if (tradeCount > 1000) score += 5;
  if (trades30d > 10) score += 5;

  // Redemption penalty (up to -30)
  if (redemptionRatio > 0.1) score -= 10;
  if (redemptionRatio > 0.3) score -= 10;
  if (redemptionRatio > 0.5) score -= 10;

  // PnL bonus (up to +30)
  if (pnlEstimate > 1000) score += 10;
  if (pnlEstimate > 10000) score += 10;
  if (pnlEstimate > 100000) score += 10;

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  return {
    wallet,
    tier,
    score,
    reasons,
    metrics: {
      tradeCount,
      trades30d,
      pnlEstimate,
      redemptionCount,
      redemptionUsdc,
      redemptionRatio,
    },
  };
}

/**
 * Check if a wallet passes the copy-trading filter.
 */
export function passesFilter(
  score: WalletCopyTradingScore,
  filter: CopyTradingFilter = DEFAULT_FILTER
): boolean {
  const { metrics, tier } = score;

  if (filter.minTrades && metrics.tradeCount < filter.minTrades) return false;
  if (filter.minTrades30d && metrics.trades30d < filter.minTrades30d) return false;
  if (filter.minPnl && metrics.pnlEstimate < filter.minPnl) return false;

  if (filter.minTier) {
    const tierOrder: ConfidenceTier[] = ['low', 'medium', 'high'];
    const minTierIndex = tierOrder.indexOf(filter.minTier);
    const actualTierIndex = tierOrder.indexOf(tier);
    if (actualTierIndex < minTierIndex) return false;
  }

  return true;
}

/**
 * Get tier display name.
 */
export function tierDisplayName(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'High Confidence';
    case 'medium':
      return 'Medium Confidence';
    case 'low':
      return 'Low Confidence';
  }
}

/**
 * Get tier color for UI.
 */
export function tierColor(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'red';
  }
}

/**
 * Format score for display.
 */
export function formatScore(score: WalletCopyTradingScore): string {
  const { tier, metrics } = score;
  const pnl =
    metrics.pnlEstimate >= 1000
      ? `$${(metrics.pnlEstimate / 1000).toFixed(1)}k`
      : `$${metrics.pnlEstimate.toFixed(0)}`;

  return `${tier.toUpperCase()} (${score.score}/100) | PnL: ${pnl} | ${metrics.tradeCount} trades | ${metrics.redemptionCount} redemptions`;
}
