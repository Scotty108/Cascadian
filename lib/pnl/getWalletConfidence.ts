/**
 * ============================================================================
 * Wallet PnL Confidence Scoring
 * ============================================================================
 *
 * Computes a confidence score for V20 PnL calculations based on data quality
 * factors. Wallets with high non-CLOB activity, missing redemptions, or other
 * data issues will have lower confidence scores.
 *
 * CONFIDENCE LEVELS:
 *   - HIGH (>= 0.9):   V20 PnL is reliable
 *   - MEDIUM (0.7-0.9): V20 PnL is usable but may have minor discrepancies
 *   - LOW (< 0.7):     V20 PnL may be significantly off, use with caution
 *
 * FACTORS AFFECTING CONFIDENCE:
 *   1. Non-CLOB USDC ratio: Higher = lower confidence
 *   2. Transfer-only positions: Higher = lower confidence
 *   3. Unresolved position ratio: Higher = more uncertainty
 *   4. Multi-outcome market ratio: Higher = lower confidence
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../clickhouse/client';

export interface WalletConfidence {
  wallet: string;
  confidence_score: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';

  // Factor breakdown
  non_clob_usdc_ratio: number;
  transfer_only_ratio: number;
  unresolved_ratio: number;
  multi_outcome_ratio: number;

  // Raw counts
  total_positions: number;
  clob_positions: number;
  transfer_only_positions: number;
  unresolved_positions: number;
  multi_outcome_markets: number;
  total_markets: number;

  // Warning flags
  warnings: string[];
}

/**
 * Calculate confidence score for a wallet's V20 PnL calculation
 */
export async function getWalletConfidence(wallet: string): Promise<WalletConfidence> {
  const query = `
    WITH
      -- Position aggregates
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price,
          countIf(source_type = 'CLOB') AS clob_events,
          countIf(source_type = 'PayoutRedemption') AS redemption_events,
          countIf(source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) AS transfer_events,
          abs(sumIf(usdc_delta, source_type != 'CLOB')) AS non_clob_usdc
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      ),
      -- Market-level info
      market_info AS (
        SELECT
          condition_id,
          uniqExact(outcome_index) AS outcome_count
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id
      )
    SELECT
      -- Position counts
      count() AS total_positions,
      sumIf(1, clob_events > 0) AS clob_positions,
      sumIf(1, clob_events = 0 AND transfer_events > 0) AS transfer_only_positions,
      sumIf(1, resolution_price IS NULL) AS unresolved_positions,

      -- USDC breakdown
      sum(abs(cash_flow)) AS total_usdc_magnitude,
      sum(non_clob_usdc) AS total_non_clob_usdc,

      -- Market counts
      uniqExact(condition_id) AS total_markets,
      (
        SELECT count()
        FROM market_info
        WHERE outcome_count > 2
      ) AS multi_outcome_markets
    FROM positions
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return {
      wallet,
      confidence_score: 1.0,
      confidence_level: 'HIGH',
      non_clob_usdc_ratio: 0,
      transfer_only_ratio: 0,
      unresolved_ratio: 0,
      multi_outcome_ratio: 0,
      total_positions: 0,
      clob_positions: 0,
      transfer_only_positions: 0,
      unresolved_positions: 0,
      multi_outcome_markets: 0,
      total_markets: 0,
      warnings: [],
    };
  }

  const data = rows[0];

  const totalPositions = Number(data.total_positions) || 0;
  const clobPositions = Number(data.clob_positions) || 0;
  const transferOnlyPositions = Number(data.transfer_only_positions) || 0;
  const unresolvedPositions = Number(data.unresolved_positions) || 0;
  const totalMarkets = Number(data.total_markets) || 0;
  const multiOutcomeMarkets = Number(data.multi_outcome_markets) || 0;
  const totalUsdcMagnitude = Number(data.total_usdc_magnitude) || 0;
  const totalNonClobUsdc = Number(data.total_non_clob_usdc) || 0;

  // Calculate ratios
  const nonClobUsdcRatio = totalUsdcMagnitude > 0 ? totalNonClobUsdc / totalUsdcMagnitude : 0;
  const transferOnlyRatio = totalPositions > 0 ? transferOnlyPositions / totalPositions : 0;
  const unresolvedRatio = totalPositions > 0 ? unresolvedPositions / totalPositions : 0;
  const multiOutcomeRatio = totalMarkets > 0 ? multiOutcomeMarkets / totalMarkets : 0;

  // Calculate confidence score (1.0 = perfect, 0.0 = no confidence)
  // Each factor can reduce confidence
  // CALIBRATED 2025-12-04 to achieve 99%+ pass rate for HIGH confidence
  let confidenceScore = 1.0;

  // Non-CLOB USDC penalty (most important factor)
  // TIGHTENED: Even 10% non-CLOB can cause significant error
  // Wallet 0x5bffcf with 16.4% non-CLOB had 29% error
  if (nonClobUsdcRatio > 0.10) {
    // Stronger penalty for >10% non-CLOB
    confidenceScore -= Math.min(0.4, nonClobUsdcRatio * 0.8);
  } else if (nonClobUsdcRatio > 0.02) {
    // Mild penalty starting at 2%
    confidenceScore -= nonClobUsdcRatio * 0.5;
  }

  // Transfer-only positions penalty
  if (transferOnlyRatio > 0.05) {
    confidenceScore -= Math.min(0.3, transferOnlyRatio * 0.6);
  }

  // Unresolved positions add uncertainty (smaller penalty)
  if (unresolvedRatio > 0.3) {
    confidenceScore -= Math.min(0.15, (unresolvedRatio - 0.3) * 0.3);
  }

  // Multi-outcome markets (minor penalty)
  if (multiOutcomeRatio > 0.1) {
    confidenceScore -= Math.min(0.1, (multiOutcomeRatio - 0.1) * 0.3);
  }

  // Data quality penalty: If wallet has few positions but high total activity
  // this suggests positions may be missing from ledger
  // Wallet 0x3d1ecf had only 15 positions but significant UI PnL gap
  const avgUsdcPerPosition = totalPositions > 0 ? totalUsdcMagnitude / totalPositions : 0;
  if (avgUsdcPerPosition > 500000 && totalPositions < 50) {
    // High USDC per position with few positions = potential data gaps
    confidenceScore -= 0.05;
  }

  // Clamp to [0, 1]
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));

  // Determine confidence level
  let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  if (confidenceScore >= 0.9) {
    confidenceLevel = 'HIGH';
  } else if (confidenceScore >= 0.7) {
    confidenceLevel = 'MEDIUM';
  } else {
    confidenceLevel = 'LOW';
  }

  // Generate warnings (thresholds match penalty thresholds above)
  const warnings: string[] = [];
  if (nonClobUsdcRatio > 0.10) {
    warnings.push(`High non-CLOB activity: ${(nonClobUsdcRatio * 100).toFixed(1)}% of USDC`);
  }
  if (transferOnlyRatio > 0.05) {
    warnings.push(`Transfer-only positions: ${transferOnlyPositions} (${(transferOnlyRatio * 100).toFixed(1)}%)`);
  }
  if (unresolvedRatio > 0.3) {
    warnings.push(`High unresolved ratio: ${(unresolvedRatio * 100).toFixed(1)}%`);
  }
  if (multiOutcomeRatio > 0.1) {
    warnings.push(`Multi-outcome markets: ${multiOutcomeMarkets} (${(multiOutcomeRatio * 100).toFixed(1)}%)`);
  }
  if (avgUsdcPerPosition > 500000 && totalPositions < 50) {
    warnings.push(`Sparse data: $${(avgUsdcPerPosition / 1000).toFixed(0)}K avg per position with only ${totalPositions} positions`);
  }

  return {
    wallet,
    confidence_score: Math.round(confidenceScore * 1000) / 1000,
    confidence_level: confidenceLevel,
    non_clob_usdc_ratio: Math.round(nonClobUsdcRatio * 1000) / 1000,
    transfer_only_ratio: Math.round(transferOnlyRatio * 1000) / 1000,
    unresolved_ratio: Math.round(unresolvedRatio * 1000) / 1000,
    multi_outcome_ratio: Math.round(multiOutcomeRatio * 1000) / 1000,
    total_positions: totalPositions,
    clob_positions: clobPositions,
    transfer_only_positions: transferOnlyPositions,
    unresolved_positions: unresolvedPositions,
    multi_outcome_markets: multiOutcomeMarkets,
    total_markets: totalMarkets,
    warnings,
  };
}

/**
 * Get confidence for multiple wallets in batch
 */
export async function getWalletsConfidence(wallets: string[]): Promise<Map<string, WalletConfidence>> {
  const results = new Map<string, WalletConfidence>();

  // Process in parallel batches of 5
  const batchSize = 5;
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const promises = batch.map((w) => getWalletConfidence(w));
    const batchResults = await Promise.all(promises);
    for (const result of batchResults) {
      results.set(result.wallet.toLowerCase(), result);
    }
  }

  return results;
}
