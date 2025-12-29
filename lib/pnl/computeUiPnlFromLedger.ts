/**
 * UI PnL Estimate Calculator - Ledger-based
 *
 * Simple PnL calculation using pm_unified_ledger_v5:
 * - For retail wallets: sum(usdc_delta) = realized cash PnL
 * - For operator wallets: same, but with confidence warning
 *
 * This approach uses the pre-deduplicated ledger view for accuracy.
 */

import { clickhouse } from '../clickhouse/client';

export interface UiPnlLedgerResult {
  wallet: string;

  // Components from ledger
  clobUsdcDelta: number;
  redemptionUsdc: number;
  splitUsdc: number;
  mergeUsdc: number;

  // Position info
  longWinnerTokens: number;
  shortWinnerTokens: number;

  // Computed
  realizedCashPnl: number;
  unredeemedLongWinners: number;
  shortLiability: number;

  // Classification
  shortRatio: number;
  walletTier: 'retail' | 'mixed' | 'operator';

  // Final
  uiPnlEstimate: number;
  confidence: 'high' | 'medium' | 'low';
}

export async function computeUiPnlFromLedger(wallet: string): Promise<UiPnlLedgerResult> {
  // Get aggregates from unified ledger
  const result = await clickhouse.query({
    query: `
      SELECT
        -- Cash flow by source
        sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
        sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
        sumIf(usdc_delta, source_type = 'PositionSplit') AS split_usdc,
        sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,

        -- Total realized
        sum(usdc_delta) AS total_usdc_delta,

        -- Token positions on resolved winners
        sumIf(token_delta, payout_norm = 1 AND token_delta > 0 AND source_type = 'CLOB') AS long_winner_tokens,
        sumIf(abs(token_delta), payout_norm = 1 AND token_delta < 0 AND source_type = 'CLOB') AS short_winner_tokens,

        -- For short ratio calculation
        sumIf(token_delta, token_delta > 0 AND source_type = 'CLOB') AS total_long_tokens,
        sumIf(abs(token_delta), token_delta < 0 AND source_type = 'CLOB') AS total_short_tokens

      FROM pm_unified_ledger_v5
      WHERE wallet_address = {wallet:String}
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const data = ((await result.json()) as any[])[0];

  // Extract values
  const clobUsdcDelta = data.clob_usdc || 0;
  const redemptionUsdc = data.redemption_usdc || 0;
  const splitUsdc = data.split_usdc || 0;
  const mergeUsdc = data.merge_usdc || 0;
  const longWinnerTokens = data.long_winner_tokens || 0;
  const shortWinnerTokens = data.short_winner_tokens || 0;
  const totalLongTokens = data.total_long_tokens || 0;
  const totalShortTokens = data.total_short_tokens || 0;

  // Realized cash PnL = sum of all usdc deltas
  const realizedCashPnl = data.total_usdc_delta || 0;

  // Unredeemed long winners = long winner tokens - (redeemed tokens)
  // Since redemption removes tokens at $1 each, unredeemed = gross - redeemed
  const unredeemedLongWinners = Math.max(0, longWinnerTokens - redemptionUsdc);

  // Short liability = short winners that weren't covered
  const shortLiability = shortWinnerTokens;

  // Calculate short ratio for tier classification
  const totalResolved = longWinnerTokens + shortWinnerTokens;
  const shortRatio = totalResolved > 0 ? shortWinnerTokens / totalResolved : 0;

  // Classify wallet
  let walletTier: 'retail' | 'mixed' | 'operator';
  if (shortRatio < 0.1) {
    walletTier = 'retail';
  } else if (shortRatio < 0.3) {
    walletTier = 'mixed';
  } else {
    walletTier = 'operator';
  }

  // For UI PnL estimate:
  // Retail: Just use realized cash PnL (matches Polymarket UI for most cases)
  // The unredeemed winners are a known edge case that Polymarket UI also doesn't show
  let uiPnlEstimate: number;
  let confidence: 'high' | 'medium' | 'low';

  if (walletTier === 'retail') {
    // For retail, realized cash is the best estimate
    uiPnlEstimate = realizedCashPnl;
    confidence = 'high';
  } else if (walletTier === 'mixed') {
    // For mixed, add unredeemed but subtract liability
    uiPnlEstimate = realizedCashPnl + unredeemedLongWinners - shortLiability;
    confidence = 'medium';
  } else {
    // For operators, the formula breaks down
    uiPnlEstimate = realizedCashPnl + unredeemedLongWinners - shortLiability;
    confidence = 'low';
  }

  return {
    wallet,
    clobUsdcDelta,
    redemptionUsdc,
    splitUsdc,
    mergeUsdc,
    longWinnerTokens,
    shortWinnerTokens,
    realizedCashPnl,
    unredeemedLongWinners,
    shortLiability,
    shortRatio,
    walletTier,
    uiPnlEstimate,
    confidence,
  };
}

/**
 * Format a dollar amount for display
 */
export function formatUsd(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}
