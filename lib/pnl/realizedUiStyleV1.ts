/**
 * UI-Style Realized PnL Calculation - V1
 *
 * SILVER BULLET: The Polymarket UI calculates realized PnL using a POSITION-BASED model:
 *
 * For each resolved market position:
 *   realized_pnl = (tokens_bought * payout_price) - cost_basis
 *
 * Where:
 * - tokens_bought = shares acquired via CLOB (positive token_delta from CLOB trades)
 * - payout_price = 0 or 1 based on resolution (from payout_numerators array)
 * - cost_basis = USDC spent to acquire shares (negative usdc_delta from CLOB trades)
 *
 * This is DIFFERENT from the cash-flow model we were using before:
 * - Old model: cash_realized + unredeemed_winning_value
 * - New model: sum over positions of (final_value - cost_basis)
 *
 * The key insight is that redemptions DON'T MATTER for PnL calculation.
 * Whether you redeem your winning shares or not, the PnL is the same.
 */
import { clickhouse } from '../clickhouse/client';

export interface UiStyleRealizedResult {
  wallet: string;
  realized_pnl: number;
  unrealized_value_estimate: number;
  total_positions: number;
  resolved_positions: number;
  winning_positions: number;
  losing_positions: number;
  position_details?: PositionDetail[];
}

export interface PositionDetail {
  condition_id: string;
  outcome_index: number;
  tokens_bought: number;
  cost_basis: number;
  payout_price: number;
  final_value: number;
  pnl: number;
  is_resolved: boolean;
}

/**
 * Calculate UI-style realized PnL for a single wallet.
 *
 * This matches how the Polymarket UI calculates the "Profit/Loss" number.
 */
export async function calculateRealizedUiStyle(
  wallet: string,
  includeDetails: boolean = false
): Promise<UiStyleRealizedResult> {
  wallet = wallet.toLowerCase();

  // Step 1: Get all CLOB positions (buys) at outcome level
  const positionsQuery = `
    SELECT
      condition_id,
      outcome_index,
      sum(token_delta) as tokens_bought,
      sum(usdc_delta) as usdc_spent
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
      AND source_type = 'CLOB'
    GROUP BY condition_id, outcome_index
    HAVING tokens_bought > 0.01
  `;

  const positionsResult = await clickhouse.query({ query: positionsQuery, format: 'JSONEachRow' });
  const positions = (await positionsResult.json()) as any[];

  // Step 2: Get all resolutions
  const resolutionsQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
  `;

  const resolutionsResult = await clickhouse.query({ query: resolutionsQuery, format: 'JSONEachRow' });
  const resolutions = new Map<string, number[]>();
  for (const row of (await resolutionsResult.json()) as any[]) {
    try {
      resolutions.set(row.condition_id, JSON.parse(row.payout_numerators));
    } catch {
      // Skip invalid payouts
    }
  }

  // Step 3: Calculate PnL for each position
  let realizedPnL = 0;
  let unrealizedValueEstimate = 0;
  let resolvedPositions = 0;
  let winningPositions = 0;
  let losingPositions = 0;
  const details: PositionDetail[] = [];

  for (const pos of positions) {
    const conditionId = pos.condition_id;
    const outcomeIndex = Number(pos.outcome_index);
    const tokensBought = Number(pos.tokens_bought);
    const costBasis = -Number(pos.usdc_spent); // Convert to positive cost

    const payouts = resolutions.get(conditionId);

    if (payouts && outcomeIndex < payouts.length) {
      // Resolved market
      const payoutPrice = payouts[outcomeIndex]; // 0 or 1
      const finalValue = tokensBought * payoutPrice;
      const pnl = finalValue - costBasis;

      realizedPnL += pnl;
      resolvedPositions++;

      if (payoutPrice > 0) {
        winningPositions++;
      } else {
        losingPositions++;
      }

      if (includeDetails) {
        details.push({
          condition_id: conditionId,
          outcome_index: outcomeIndex,
          tokens_bought: tokensBought,
          cost_basis: costBasis,
          payout_price: payoutPrice,
          final_value: finalValue,
          pnl,
          is_resolved: true,
        });
      }
    } else {
      // Unresolved market - estimate at 50% for now
      // (In a real implementation, we'd fetch current market prices)
      const estimatedValue = tokensBought * 0.5;
      unrealizedValueEstimate += estimatedValue;

      if (includeDetails) {
        details.push({
          condition_id: conditionId,
          outcome_index: outcomeIndex,
          tokens_bought: tokensBought,
          cost_basis: costBasis,
          payout_price: 0.5, // estimate
          final_value: estimatedValue,
          pnl: estimatedValue - costBasis,
          is_resolved: false,
        });
      }
    }
  }

  const result: UiStyleRealizedResult = {
    wallet,
    realized_pnl: realizedPnL,
    unrealized_value_estimate: unrealizedValueEstimate,
    total_positions: positions.length,
    resolved_positions: resolvedPositions,
    winning_positions: winningPositions,
    losing_positions: losingPositions,
  };

  if (includeDetails) {
    result.position_details = details;
  }

  return result;
}

/**
 * Batch calculate UI-style realized PnL for multiple wallets
 */
export async function calculateRealizedUiStyleBatch(
  wallets: string[]
): Promise<UiStyleRealizedResult[]> {
  const results: UiStyleRealizedResult[] = [];

  for (const wallet of wallets) {
    try {
      const result = await calculateRealizedUiStyle(wallet);
      results.push(result);
    } catch (err: any) {
      console.error(`Error calculating for ${wallet}: ${err.message}`);
    }
  }

  return results;
}
