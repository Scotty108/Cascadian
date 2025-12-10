/**
 * ============================================================================
 * GOLDEN PNL ENGINE - V26
 * ============================================================================
 *
 * PURPOSE: Achieve accurate PnL for BOTH pure traders AND market makers
 *
 * THE KEY INSIGHT FROM AUDITOR:
 * - The Auditor's query uses pm_unified_ledger_v7 + vw_pm_resolution_prices
 * - For the Trump 2024 Golden Test (zxgngl wallet), this achieved 0.91% error
 * - The query worked across ALL source_types (CLOB, Split, Merge, Redemption)
 *
 * V26 STRATEGY:
 * 1. Query pm_unified_ledger_v7 for ALL source types (like Auditor's query)
 * 2. Get resolution prices with FALLBACK:
 *    - Primary: vw_pm_resolution_prices view
 *    - Fallback: payout_norm from ledger row (for older markets)
 * 3. Apply V20 formula: PnL = cash_flow + (net_tokens * resolution_price)
 * 4. For unresolved: Mark at 0 (realized-only mode) or 0.5 (with unrealized)
 *
 * V26 vs V25:
 * - V25 failed (380% error) because it marked unresolved at 0.5 for Split/Merge events
 * - V26 uses realized-only mode: unresolved positions = 0 PnL
 *
 * V26 vs V23:
 * - V23 uses CLOB-only filter (works for pure traders)
 * - V26 uses ALL source types (works for market makers too)
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface V26MarketPnL {
  conditionId: string;
  outcomeIndex: number;
  cashFlow: number;      // Σ usdc_delta
  netTokens: number;     // Σ token_delta
  resolvedPrice: number | null;
  pnl: number;
  isResolved: boolean;
  resolutionSource: 'view' | 'ledger' | 'none';
}

export interface V26WalletResult {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  marketsTraded: number;
  resolvedMarkets: number;
  unresolvedMarkets: number;
  eventCount: number;

  // Source breakdown
  clobUsdc: number;
  splitUsdc: number;
  mergeUsdc: number;
  redemptionUsdc: number;

  // Resolution source stats
  viewResolutions: number;
  ledgerResolutions: number;
  missingResolutions: number;
}

// ============================================================================
// The Golden Query - Based on Auditor's Proven Formula
// ============================================================================

/**
 * Calculate PnL using the EXACT formula that the Auditor validated.
 *
 * The Auditor's query:
 * ```sql
 * SELECT
 *   l.outcome_index,
 *   sum(l.usdc_delta) as usdc_sum,
 *   sum(l.token_delta) as token_sum,
 *   r.resolved_price,
 *   sum(l.usdc_delta) + sum(l.token_delta) * r.resolved_price as pnl
 * FROM pm_unified_ledger_v7 l
 * LEFT JOIN vw_pm_resolution_prices r
 *   ON l.condition_id = r.condition_id
 *   AND l.outcome_index = r.outcome_index
 * WHERE lower(l.wallet_address) = lower('0x...')
 *   AND l.condition_id = '...'
 * GROUP BY l.outcome_index, r.resolved_price
 * ```
 *
 * This query:
 * - Uses ALL source_types (no filter)
 * - Joins resolution prices from the view
 * - Groups by outcome to get net position
 * - Applies V20 formula: cash_flow + tokens * price
 */
export async function calculateV26WalletPnL(wallet: string): Promise<V26WalletResult> {
  // Step 1: Get aggregated data per condition+outcome with resolution prices
  // Use LEFT JOIN so we get data even if no resolution price exists
  const query = `
    WITH wallet_positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS net_tokens,
        sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
        sumIf(usdc_delta, source_type = 'PositionSplit') AS split_usdc,
        sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
        sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
        count() AS event_count,
        -- Get payout_norm from ledger as fallback (from PayoutRedemption events)
        anyIf(payout_norm, source_type = 'PayoutRedemption' AND payout_norm IS NOT NULL) AS ledger_payout_norm
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      wp.condition_id,
      wp.outcome_index,
      wp.cash_flow,
      wp.net_tokens,
      wp.clob_usdc,
      wp.split_usdc,
      wp.merge_usdc,
      wp.redemption_usdc,
      wp.event_count,
      -- Resolution price: primary from view, fallback from ledger
      r.resolved_price AS view_resolved_price,
      wp.ledger_payout_norm,
      -- Use COALESCE for the actual resolution price
      coalesce(r.resolved_price, toFloat64(wp.ledger_payout_norm)) AS resolved_price
    FROM wallet_positions wp
    LEFT JOIN vw_pm_resolution_prices r
      ON lower(r.condition_id) = lower(wp.condition_id)
      AND r.outcome_index = wp.outcome_index
    ORDER BY wp.condition_id, wp.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Aggregate results
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let clobUsdc = 0;
  let splitUsdc = 0;
  let mergeUsdc = 0;
  let redemptionUsdc = 0;
  let eventCount = 0;
  let viewResolutions = 0;
  let ledgerResolutions = 0;
  let missingResolutions = 0;

  const marketsSeen = new Set<string>();
  const resolvedMarkets = new Set<string>();

  for (const r of rows) {
    const conditionId = r.condition_id?.toLowerCase() || '';
    const cashFlow = Number(r.cash_flow) || 0;
    const netTokens = Number(r.net_tokens) || 0;
    const viewPrice = r.view_resolved_price !== null ? Number(r.view_resolved_price) : null;
    const ledgerPrice = r.ledger_payout_norm !== null ? Number(r.ledger_payout_norm) : null;
    const resolvedPrice = r.resolved_price !== null ? Number(r.resolved_price) : null;

    marketsSeen.add(conditionId);

    // Track resolution source
    if (viewPrice !== null) {
      viewResolutions++;
      resolvedMarkets.add(conditionId);
    } else if (ledgerPrice !== null) {
      ledgerResolutions++;
      resolvedMarkets.add(conditionId);
    } else {
      missingResolutions++;
    }

    // Calculate PnL using the Auditor's formula
    // For resolved: PnL = cash_flow + net_tokens * resolved_price
    // For unresolved: PnL = 0 (realized-only mode)
    if (resolvedPrice !== null) {
      const pnl = cashFlow + netTokens * resolvedPrice;
      realizedPnl += pnl;
    } else {
      // Unresolved: Do NOT mark at 0.5 (this was V25's fatal flaw)
      // Instead, treat as 0 realized PnL (position still open)
      unrealizedPnl += 0; // Explicitly 0 for realized-only mode
    }

    // Aggregate source breakdowns
    clobUsdc += Number(r.clob_usdc) || 0;
    splitUsdc += Number(r.split_usdc) || 0;
    mergeUsdc += Number(r.merge_usdc) || 0;
    redemptionUsdc += Number(r.redemption_usdc) || 0;
    eventCount += Number(r.event_count) || 0;
  }

  return {
    wallet: wallet.toLowerCase(),
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    marketsTraded: marketsSeen.size,
    resolvedMarkets: resolvedMarkets.size,
    unresolvedMarkets: marketsSeen.size - resolvedMarkets.size,
    eventCount,
    clobUsdc: Math.round(clobUsdc * 100) / 100,
    splitUsdc: Math.round(splitUsdc * 100) / 100,
    mergeUsdc: Math.round(mergeUsdc * 100) / 100,
    redemptionUsdc: Math.round(redemptionUsdc * 100) / 100,
    viewResolutions,
    ledgerResolutions,
    missingResolutions,
  };
}

// ============================================================================
// Per-Market PnL (for Golden Test validation)
// ============================================================================

export async function calculateV26MarketPnL(
  wallet: string,
  conditionId: string
): Promise<V26MarketPnL[]> {
  // Query exactly like the Auditor's Golden Test
  const query = `
    SELECT
      l.outcome_index,
      sum(l.usdc_delta) as cash_flow,
      sum(l.token_delta) as net_tokens,
      r.resolved_price AS view_price,
      anyIf(l.payout_norm, l.source_type = 'PayoutRedemption' AND l.payout_norm IS NOT NULL) AS ledger_price
    FROM pm_unified_ledger_v7 l
    LEFT JOIN vw_pm_resolution_prices r
      ON lower(l.condition_id) = lower(r.condition_id)
      AND l.outcome_index = r.outcome_index
    WHERE lower(l.wallet_address) = lower('${wallet}')
      AND lower(l.condition_id) = lower('${conditionId}')
    GROUP BY l.outcome_index, r.resolved_price
    ORDER BY l.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const outcomes: V26MarketPnL[] = [];

  for (const r of rows) {
    const cashFlow = Number(r.cash_flow) || 0;
    const netTokens = Number(r.net_tokens) || 0;
    const viewPrice = r.view_price !== null ? Number(r.view_price) : null;
    const ledgerPrice = r.ledger_price !== null ? Number(r.ledger_price) : null;

    // Determine resolution source
    let resolvedPrice: number | null = null;
    let resolutionSource: 'view' | 'ledger' | 'none' = 'none';

    if (viewPrice !== null) {
      resolvedPrice = viewPrice;
      resolutionSource = 'view';
    } else if (ledgerPrice !== null) {
      resolvedPrice = ledgerPrice;
      resolutionSource = 'ledger';
    }

    const isResolved = resolvedPrice !== null;
    const pnl = isResolved ? cashFlow + netTokens * resolvedPrice! : 0;

    outcomes.push({
      conditionId: conditionId.toLowerCase(),
      outcomeIndex: Number(r.outcome_index),
      cashFlow,
      netTokens,
      resolvedPrice,
      pnl,
      isResolved,
      resolutionSource,
    });
  }

  return outcomes;
}

// ============================================================================
// Quick PnL for Benchmarking (matches V20/V23 interface)
// ============================================================================

export interface V26QuickResult {
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  markets_traded: number;
  event_count: number;
}

export async function calculateV26PnL(wallet: string): Promise<V26QuickResult> {
  const result = await calculateV26WalletPnL(wallet);
  return {
    total_pnl: result.totalPnl,
    realized_pnl: result.realizedPnl,
    unrealized_pnl: result.unrealizedPnl,
    markets_traded: result.marketsTraded,
    event_count: result.eventCount,
  };
}

// ============================================================================
// Golden Test Validation
// ============================================================================

export interface GoldenTestResult {
  wallet: string;
  conditionId: string;
  expectedPnl: number;
  calculatedPnl: number;
  errorPct: number;
  passed: boolean;
  outcomes: V26MarketPnL[];
}

export async function runGoldenTest(
  wallet: string,
  conditionId: string,
  expectedPnl: number,
  tolerancePct: number = 1.0
): Promise<GoldenTestResult> {
  const outcomes = await calculateV26MarketPnL(wallet, conditionId);
  const calculatedPnl = outcomes.reduce((sum, o) => sum + o.pnl, 0);
  const errorPct = expectedPnl === 0
    ? (calculatedPnl === 0 ? 0 : 100)
    : Math.abs((calculatedPnl - expectedPnl) / expectedPnl) * 100;
  const passed = errorPct <= tolerancePct;

  return {
    wallet,
    conditionId,
    expectedPnl,
    calculatedPnl: Math.round(calculatedPnl * 100) / 100,
    errorPct: Math.round(errorPct * 100) / 100,
    passed,
    outcomes,
  };
}
