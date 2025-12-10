/**
 * ============================================================================
 * HYBRID PNL ENGINE - V25.1 (ROBUST HYBRID)
 * ============================================================================
 *
 * PURPOSE: Apply V20 formula across ALL source types in pm_unified_ledger_v7
 *
 * KEY INSIGHT:
 * - pm_unified_ledger_v7 is ALREADY NORMALIZED (USDC units)
 * - Previous engines (V23) filtered to CLOB-only, missing Split/Merge/Redemption
 * - V24 Sidecar failed by treating (merge - split) as PnL (wrong conceptually)
 *
 * V25.1 APPROACH (ROBUST HYBRID):
 * - Use ALL rows from pm_unified_ledger_v7 (no source_type filter)
 * - Apply V20 formula: PnL = Σ(usdc_delta) + Σ(token_delta × resolved_price)
 * - Resolution fallback priority:
 *   1. vw_pm_resolution_prices (primary - cleaner for Split/Merge)
 *   2. payout_norm from ledger (fallback - legacy support for older markets)
 *
 * FORMULA (per market, per outcome):
 *   outcome_pnl = cash_flow + net_tokens * resolved_price
 *   market_pnl = Σ outcome_pnl (across all outcomes)
 *   wallet_pnl = Σ market_pnl (across all markets)
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface MarketPnLResult {
  conditionId: string;
  wallet: string;

  // Aggregated values
  totalCashFlow: number;      // Σ usdc_delta across all outcomes
  totalNetTokens: number;     // Σ token_delta across all outcomes
  realizedPnl: number;        // PnL from resolved positions
  unrealizedPnl: number;      // PnL from unresolved positions (marked at 0.5)
  totalPnl: number;           // realizedPnl + unrealizedPnl

  // Resolution info
  isResolved: boolean;
  resolutionPrices: Map<number, number>; // outcome_index -> price

  // Breakdown by outcome
  outcomes: OutcomePnL[];

  // Source breakdown
  clobUsdc: number;
  splitUsdc: number;
  mergeUsdc: number;
  redemptionUsdc: number;
  eventCount: number;
}

export interface OutcomePnL {
  outcomeIndex: number;
  cashFlow: number;
  netTokens: number;
  resolvedPrice: number | null;
  pnl: number;
  isResolved: boolean;
}

export interface WalletPnLResult {
  wallet: string;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalPnl: number;
  marketsTraded: number;
  resolvedMarkets: number;
  unresolvedMarkets: number;
  eventCount: number;

  // Breakdown by source
  clobUsdc: number;
  splitUsdc: number;
  mergeUsdc: number;
  redemptionUsdc: number;
}

// ============================================================================
// Resolution Price Loader
// ============================================================================

async function loadResolutionPrices(
  conditionId: string,
  wallet?: string
): Promise<Map<number, number>> {
  // V25.1: Try vw_pm_resolution_prices first, then fallback to payout_norm from ledger
  const query = `
    SELECT
      outcome_index,
      resolved_price
    FROM vw_pm_resolution_prices
    WHERE lower(condition_id) = lower('${conditionId}')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<number, number>();
  for (const r of rows) {
    prices.set(Number(r.outcome_index), Number(r.resolved_price) || 0);
  }

  // If no resolution prices found, try fallback from payout_norm in ledger
  if (prices.size === 0 && wallet) {
    const fallbackQuery = `
      SELECT
        outcome_index,
        any(payout_norm) AS resolved_price
      FROM pm_unified_ledger_v7
      WHERE lower(condition_id) = lower('${conditionId}')
        AND lower(wallet_address) = lower('${wallet}')
        AND source_type = 'PayoutRedemption'
        AND payout_norm IS NOT NULL
      GROUP BY outcome_index
    `;
    const fallbackResult = await clickhouse.query({ query: fallbackQuery, format: 'JSONEachRow' });
    const fallbackRows = (await fallbackResult.json()) as any[];
    for (const r of fallbackRows) {
      prices.set(Number(r.outcome_index), Number(r.resolved_price) || 0);
    }
  }

  return prices;
}

async function loadAllResolutionPricesForWallet(
  wallet: string
): Promise<Map<string, Map<number, number>>> {
  // V25.1: Get resolution prices with fallback to payout_norm from ledger
  // Priority 1: vw_pm_resolution_prices (cleaner for Split/Merge events)
  // Priority 2: payout_norm from ledger (legacy support for older markets)
  const query = `
    WITH wallet_conditions AS (
      SELECT DISTINCT condition_id, outcome_index
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    ledger_payout_norm AS (
      -- Get payout_norm from PayoutRedemption events as fallback
      SELECT
        condition_id,
        outcome_index,
        anyIf(payout_norm, payout_norm IS NOT NULL) as payout_norm_val
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'PayoutRedemption'
      GROUP BY condition_id, outcome_index
      HAVING payout_norm_val IS NOT NULL
    )
    SELECT
      wc.condition_id AS condition_id,
      wc.outcome_index AS outcome_index,
      -- Priority 1: vw_pm_resolution_prices, Priority 2: payout_norm from ledger
      -- Cast payout_norm_val to Float64 to match resolved_price type
      coalesce(r.resolved_price, toFloat64(lpn.payout_norm_val)) AS resolved_price
    FROM wallet_conditions wc
    LEFT JOIN vw_pm_resolution_prices r
      ON lower(r.condition_id) = lower(wc.condition_id)
      AND r.outcome_index = wc.outcome_index
    LEFT JOIN ledger_payout_norm lpn
      ON lower(lpn.condition_id) = lower(wc.condition_id)
      AND lpn.outcome_index = wc.outcome_index
    WHERE coalesce(r.resolved_price, toFloat64(lpn.payout_norm_val)) IS NOT NULL
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const allPrices = new Map<string, Map<number, number>>();
  for (const r of rows) {
    // Skip rows with null/undefined condition_id
    if (!r.condition_id) continue;

    const conditionId = r.condition_id.toLowerCase();
    if (!allPrices.has(conditionId)) {
      allPrices.set(conditionId, new Map());
    }
    allPrices.get(conditionId)!.set(Number(r.outcome_index), Number(r.resolved_price) || 0);
  }

  return allPrices;
}

// ============================================================================
// Per-Market PnL Calculation
// ============================================================================

export async function calculateV25MarketPnL(
  wallet: string,
  conditionId: string
): Promise<MarketPnLResult> {
  // Load resolution prices for this market (with fallback to payout_norm)
  const resolutionPrices = await loadResolutionPrices(conditionId, wallet);
  const isResolved = resolutionPrices.size > 0;

  // Query pm_unified_ledger_v7 for ALL source types
  // NO source_type filter - use everything
  const query = `
    SELECT
      outcome_index,
      sum(usdc_delta) AS cash_flow,
      sum(token_delta) AS net_tokens,
      sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
      sumIf(usdc_delta, source_type = 'PositionSplit') AS split_usdc,
      sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
      count() AS event_count
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND lower(condition_id) = lower('${conditionId}')
    GROUP BY outcome_index
    ORDER BY outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const outcomes: OutcomePnL[] = [];
  let totalCashFlow = 0;
  let totalNetTokens = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let clobUsdc = 0;
  let splitUsdc = 0;
  let mergeUsdc = 0;
  let redemptionUsdc = 0;
  let eventCount = 0;

  for (const r of rows) {
    const outcomeIndex = Number(r.outcome_index);
    const cashFlow = Number(r.cash_flow) || 0;
    const netTokens = Number(r.net_tokens) || 0;

    // Get resolution price for this outcome
    const resolvedPrice = resolutionPrices.get(outcomeIndex) ?? null;
    const outcomeIsResolved = resolvedPrice !== null;

    // Calculate PnL using V20 formula:
    // For resolved: cash_flow + net_tokens * resolved_price
    // For unresolved: cash_flow + net_tokens * 0.5 (mark-to-market at 50%)
    let outcomePnl: number;
    if (outcomeIsResolved) {
      outcomePnl = cashFlow + netTokens * resolvedPrice;
      realizedPnl += outcomePnl;
    } else {
      // Mark unresolved positions at 0.5 (50 cents)
      outcomePnl = cashFlow + netTokens * 0.5;
      unrealizedPnl += outcomePnl;
    }

    outcomes.push({
      outcomeIndex,
      cashFlow,
      netTokens,
      resolvedPrice,
      pnl: outcomePnl,
      isResolved: outcomeIsResolved,
    });

    totalCashFlow += cashFlow;
    totalNetTokens += netTokens;
    clobUsdc += Number(r.clob_usdc) || 0;
    splitUsdc += Number(r.split_usdc) || 0;
    mergeUsdc += Number(r.merge_usdc) || 0;
    redemptionUsdc += Number(r.redemption_usdc) || 0;
    eventCount += Number(r.event_count) || 0;
  }

  return {
    conditionId: conditionId.toLowerCase(),
    wallet: wallet.toLowerCase(),
    totalCashFlow: Math.round(totalCashFlow * 100) / 100,
    totalNetTokens: Math.round(totalNetTokens * 100) / 100,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    isResolved,
    resolutionPrices,
    outcomes,
    clobUsdc: Math.round(clobUsdc * 100) / 100,
    splitUsdc: Math.round(splitUsdc * 100) / 100,
    mergeUsdc: Math.round(mergeUsdc * 100) / 100,
    redemptionUsdc: Math.round(redemptionUsdc * 100) / 100,
    eventCount,
  };
}

// ============================================================================
// Wallet-Level PnL Calculation
// ============================================================================

export async function calculateV25WalletPnL(wallet: string): Promise<WalletPnLResult> {
  // Load all resolution prices upfront
  const allResolutionPrices = await loadAllResolutionPricesForWallet(wallet);

  // Query pm_unified_ledger_v7 for ALL source types, grouped by condition+outcome
  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(usdc_delta) AS cash_flow,
      sum(token_delta) AS net_tokens,
      sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
      sumIf(usdc_delta, source_type = 'PositionSplit') AS split_usdc,
      sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
      count() AS event_count
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
    GROUP BY condition_id, outcome_index
    ORDER BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let clobUsdc = 0;
  let splitUsdc = 0;
  let mergeUsdc = 0;
  let redemptionUsdc = 0;
  let eventCount = 0;

  const marketsSeen = new Set<string>();
  const resolvedMarkets = new Set<string>();

  for (const r of rows) {
    const conditionId = r.condition_id.toLowerCase();
    const outcomeIndex = Number(r.outcome_index);
    const cashFlow = Number(r.cash_flow) || 0;
    const netTokens = Number(r.net_tokens) || 0;

    marketsSeen.add(conditionId);

    // Get resolution price for this condition+outcome
    const conditionPrices = allResolutionPrices.get(conditionId);
    const resolvedPrice = conditionPrices?.get(outcomeIndex) ?? null;
    const isResolved = resolvedPrice !== null;

    if (isResolved) {
      resolvedMarkets.add(conditionId);
    }

    // Calculate PnL using V20 formula
    let outcomePnl: number;
    if (isResolved) {
      outcomePnl = cashFlow + netTokens * resolvedPrice;
      totalRealizedPnl += outcomePnl;
    } else {
      // Mark unresolved at 0.5
      outcomePnl = cashFlow + netTokens * 0.5;
      totalUnrealizedPnl += outcomePnl;
    }

    clobUsdc += Number(r.clob_usdc) || 0;
    splitUsdc += Number(r.split_usdc) || 0;
    mergeUsdc += Number(r.merge_usdc) || 0;
    redemptionUsdc += Number(r.redemption_usdc) || 0;
    eventCount += Number(r.event_count) || 0;
  }

  return {
    wallet: wallet.toLowerCase(),
    totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
    totalPnl: Math.round((totalRealizedPnl + totalUnrealizedPnl) * 100) / 100,
    marketsTraded: marketsSeen.size,
    resolvedMarkets: resolvedMarkets.size,
    unresolvedMarkets: marketsSeen.size - resolvedMarkets.size,
    eventCount,
    clobUsdc: Math.round(clobUsdc * 100) / 100,
    splitUsdc: Math.round(splitUsdc * 100) / 100,
    mergeUsdc: Math.round(mergeUsdc * 100) / 100,
    redemptionUsdc: Math.round(redemptionUsdc * 100) / 100,
  };
}

// ============================================================================
// Quick PnL for benchmarking (matches V20/V23 interface)
// ============================================================================

export interface V25QuickResult {
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  markets_traded: number;
  event_count: number;
}

export async function calculateV25PnL(wallet: string): Promise<V25QuickResult> {
  const result = await calculateV25WalletPnL(wallet);
  return {
    total_pnl: result.totalPnl,
    realized_pnl: result.totalRealizedPnl,
    unrealized_pnl: result.totalUnrealizedPnl,
    markets_traded: result.marketsTraded,
    event_count: result.eventCount,
  };
}
