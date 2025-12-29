/**
 * Dome-like Realized PnL Calculation - V1
 *
 * Definition: dome_like_realized = cash_realized + resolved_unredeemed_winning_value
 *
 * Components:
 * 1. cash_realized = sum(usdc_delta) across ALL source_types (CLOB, PayoutRedemption, etc.)
 * 2. resolved_unredeemed_winning_value = value of WINNING shares still held in resolved markets
 *
 * CRITICAL DATA QUIRK:
 * - PayoutRedemption events ALWAYS record on outcome_index=0, regardless of which outcome won
 * - CLOB buys record on the CORRECT outcome_index
 *
 * ALGORITHM:
 * For unredeemed calculation, we need to track at (condition_id, outcome_index) level using
 * CLOB-only trades to know which outcome the user bet on. Then check payout_numerators to
 * see if that specific outcome won.
 *
 * But we also need to net redemptions. Since redemptions always go to outcome_index=0, we
 * need to apply them proportionally or to the winning outcome.
 *
 * SIMPLIFICATION: For now, compute net shares per (condition_id, outcome_index) from CLOB only,
 * then separately compute redemption totals per condition_id and subtract from winning positions.
 */
import { clickhouse } from '../clickhouse/client';

export interface DomeLikeRealizedResult {
  wallet: string;
  cash_realized: number;
  cash_breakdown: {
    clob: number;
    redemption: number;
    other: number;
  };
  resolved_unredeemed_winning_value: number;
  realized_dome_like: number;
  winning_positions_held: number;
  losing_positions_held: number;
  total_conditions_traded: number;
  total_conditions_resolved: number;
}

/**
 * Calculate Dome-like realized PnL for a single wallet.
 *
 * This matches the semantic definition used by Dome/Polymarket:
 * - Cash movements are counted
 * - Unredeemed winning positions in resolved markets are valued at $1/share
 */
export async function calculateRealizedDomeLike(
  wallet: string
): Promise<DomeLikeRealizedResult> {
  wallet = wallet.toLowerCase();

  // Step 1: Cash realized = sum of all usdc_delta, broken down by source_type
  const cashQuery = `
    SELECT
      sum(usdc_delta) as cash_realized,
      sumIf(usdc_delta, source_type = 'CLOB') as clob_cash,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_cash,
      sumIf(usdc_delta, source_type NOT IN ('CLOB', 'PayoutRedemption')) as other_cash,
      countDistinct(condition_id) as total_conditions
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
  `;

  const cashResult = await clickhouse.query({ query: cashQuery, format: 'JSONEachRow' });
  const cashRows = (await cashResult.json()) as any[];
  const cashRow = cashRows[0];

  const cashRealized = Number(cashRow?.cash_realized || 0);
  const clobCash = Number(cashRow?.clob_cash || 0);
  const redemptionCash = Number(cashRow?.redemption_cash || 0);
  const otherCash = Number(cashRow?.other_cash || 0);
  const totalConditions = Number(cashRow?.total_conditions || 0);

  // Step 2: Resolved unredeemed winning value
  //
  // OUTCOME-LEVEL ALGORITHM:
  // 1. Calculate net_shares at (condition_id, outcome_index) level from CLOB trades
  // 2. Get total redemptions per condition (redemptions always record on outcome_index=0)
  // 3. For each outcome with net positive shares, check if that outcome won
  // 4. If won, add shares to unredeemed value (minus proportional redemption share)
  //
  // Key insight: Redemptions should reduce winning positions, not be applied to outcome 0.
  // Since redemptions are per-condition (not per-outcome), we subtract them from total
  // winning shares for that condition.

  const unredeemedQuery = `
    WITH
      -- Net shares per outcome from CLOB only (accurate outcome_index)
      clob_by_outcome AS (
        SELECT
          condition_id,
          outcome_index,
          sum(token_delta) AS net_shares
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = '${wallet}'
          AND condition_id != ''
          AND source_type = 'CLOB'
        GROUP BY condition_id, outcome_index
      ),
      -- Total redemptions per condition (these reduce positions)
      redemptions_per_cond AS (
        SELECT
          condition_id,
          sum(token_delta) AS redemption_tokens
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = '${wallet}'
          AND condition_id != ''
          AND source_type = 'PayoutRedemption'
        GROUP BY condition_id
      ),
      -- Resolutions with payout info
      resolutions AS (
        SELECT
          condition_id,
          payout_numerators
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      )
    SELECT
      c.condition_id AS cond_id,
      c.outcome_index,
      c.net_shares AS clob_net_shares,
      coalesce(red.redemption_tokens, 0) AS redemption_tokens,
      r.payout_numerators
    FROM clob_by_outcome c
    INNER JOIN resolutions r ON c.condition_id = r.condition_id
    LEFT JOIN redemptions_per_cond red ON c.condition_id = red.condition_id
    WHERE c.net_shares > 0.01
  `;

  const unredeemedResult = await clickhouse.query({ query: unredeemedQuery, format: 'JSONEachRow' });
  const unredeemedRows = (await unredeemedResult.json()) as any[];

  let resolvedUnredeemedValue = 0;
  let winningPositionsHeld = 0;
  let losingPositionsHeld = 0;

  // Track conditions and their winning outcomes for redemption netting
  const conditionWinningShares: Map<string, { shares: number; outcomeIdx: number }[]> = new Map();
  const conditionRedemptions: Map<string, number> = new Map();
  const resolvedConditions = new Set<string>();

  // First pass: identify winning positions per condition
  for (const row of unredeemedRows) {
    const clobNetShares = Number(row.clob_net_shares);
    const outcomeIndex = Number(row.outcome_index);
    const redemptionTokens = Number(row.redemption_tokens);
    const payoutsStr = row.payout_numerators;
    const conditionId = row.cond_id;

    resolvedConditions.add(conditionId);
    conditionRedemptions.set(conditionId, redemptionTokens);

    // Parse payouts and check if THIS outcome won
    let thisOutcomeWon = false;
    try {
      let payouts: number[];
      if (payoutsStr.startsWith('[')) {
        payouts = JSON.parse(payoutsStr);
      } else {
        payouts = payoutsStr.split(',').map((s: string) => Number(s.trim()));
      }

      // Check if this specific outcome won
      thisOutcomeWon = payouts[outcomeIndex] > 0;
    } catch {
      continue;
    }

    if (thisOutcomeWon) {
      // This outcome won - track for redemption netting
      if (!conditionWinningShares.has(conditionId)) {
        conditionWinningShares.set(conditionId, []);
      }
      conditionWinningShares.get(conditionId)!.push({ shares: clobNetShares, outcomeIdx: outcomeIndex });
    } else {
      // This outcome lost - shares worth $0
      losingPositionsHeld++;
    }
  }

  // Second pass: apply redemptions to winning positions and sum
  for (const [conditionId, winningOutcomes] of conditionWinningShares) {
    const redemptionTokens = conditionRedemptions.get(conditionId) || 0;
    // Redemption tokens are negative (outflow), so they reduce positions
    // redemption_tokens is already negative, so we add it to get net
    const totalWinningShares = winningOutcomes.reduce((sum, o) => sum + o.shares, 0);

    // Net unredeemed = CLOB shares + redemption (redemption is negative)
    const netUnredeemed = totalWinningShares + redemptionTokens;

    if (netUnredeemed > 0.01) {
      resolvedUnredeemedValue += netUnredeemed;
      winningPositionsHeld += winningOutcomes.length;
    }
  }

  // Final: dome_like_realized = cash_realized + resolved_unredeemed_winning_value
  const realizedDomeLike = cashRealized + resolvedUnredeemedValue;

  return {
    wallet,
    cash_realized: cashRealized,
    cash_breakdown: {
      clob: clobCash,
      redemption: redemptionCash,
      other: otherCash,
    },
    resolved_unredeemed_winning_value: resolvedUnredeemedValue,
    realized_dome_like: realizedDomeLike,
    winning_positions_held: winningPositionsHeld,
    losing_positions_held: losingPositionsHeld,
    total_conditions_traded: totalConditions,
    total_conditions_resolved: resolvedConditions.size,
  };
}

/**
 * Batch calculate Dome-like realized for multiple wallets
 */
export async function calculateRealizedDomeLikeBatch(
  wallets: string[]
): Promise<DomeLikeRealizedResult[]> {
  const results: DomeLikeRealizedResult[] = [];

  for (const wallet of wallets) {
    try {
      const result = await calculateRealizedDomeLike(wallet);
      results.push(result);
    } catch (err: any) {
      console.error(`Error calculating for ${wallet}: ${err.message}`);
    }
  }

  return results;
}
