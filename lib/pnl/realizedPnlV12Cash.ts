/**
 * ============================================================================
 * REALIZED PNL ENGINE V12-CASH - DOME-STYLE STRICT CASH FLOW
 * ============================================================================
 *
 * V12Cash is the "strict" realized PnL calculator that matches Dome API's
 * definition: "realized gains only - from either confirmed sells or redeems.
 * We do not realize a gain/loss until a finished market is redeemed."
 *
 * KEY DIFFERENCE FROM V12 (SYNTHETIC):
 * - V12 Synthetic: usdc_delta + (token_delta * payout_norm)
 *   → Credits value for shares held at resolution even without redemption
 *
 * - V12Cash (this): Only actual USDC cash flows
 *   → CLOB trades: usdc_delta only (buy = spend, sell = receive)
 *   → PayoutRedemption: usdc_delta (actual payout received)
 *   → NO synthetic valuation of unredeemed shares
 *
 * DATA SOURCE: pm_unified_ledger_v8_tbl
 * - source_type = 'CLOB': Trade cash flows
 * - source_type = 'PayoutRedemption': Redemption cash flows
 *
 * PURPOSE: Dome API parity validation
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface CashRealizedPnlResult {
  wallet: string;
  realizedCash: number; // Only actual USDC flows
  clobUsdc: number; // USDC from CLOB trades only
  redemptionUsdc: number; // USDC from redemptions only
  clobEvents: number;
  redemptionEvents: number;
  totalEvents: number;
  errors: string[];
}

export interface CashRealizedStats extends CashRealizedPnlResult {
  uniqueConditions: number;
  resolvedConditions: number;
  redeemedConditions: number;
  unredeemedResolvedConditions: number;
}

// ============================================================================
// ClickHouse Client
// ============================================================================

let chClient: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!chClient) {
    chClient = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      request_timeout: 300000,
    });
  }
  return chClient;
}

export function closeClient(): Promise<void> {
  if (chClient) {
    const client = chClient;
    chClient = null;
    return client.close();
  }
  return Promise.resolve();
}

// ============================================================================
// Core Calculation - V12Cash Formula (Dome-style)
// ============================================================================

/**
 * Calculate realized PnL (cash-only) for a single wallet using V12Cash formula.
 *
 * This matches Dome's strict definition:
 * - Realized = CLOB usdc_delta + PayoutRedemption usdc_delta
 * - NO synthetic valuation of unredeemed shares
 *
 * Sources from pm_unified_ledger_v8_tbl which has both CLOB and PayoutRedemption.
 *
 * NOTE: This version does NOT dedupe CLOB - use calculateRealizedPnlV12CashV2 for accurate results.
 */
export async function calculateRealizedPnlV12Cash(
  wallet: string
): Promise<CashRealizedPnlResult> {
  const ch = getClient();

  const query = `
    SELECT
      -- CLOB USDC flows only (buy = negative, sell = positive)
      sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,

      -- Redemption USDC flows (actual payouts received)
      sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,

      -- Total realized cash = CLOB + Redemptions
      sum(
        CASE
          WHEN source_type IN ('CLOB', 'PayoutRedemption') THEN usdc_delta
          ELSE 0
        END
      ) as realized_cash,

      -- Event counts
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events,
      count() as total_events

    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address = {wallet:String}
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    return {
      wallet,
      realizedCash: Number(row.realized_cash || 0),
      clobUsdc: Number(row.clob_usdc || 0),
      redemptionUsdc: Number(row.redemption_usdc || 0),
      clobEvents: Number(row.clob_events || 0),
      redemptionEvents: Number(row.redemption_events || 0),
      totalEvents: Number(row.total_events || 0),
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      realizedCash: 0,
      clobUsdc: 0,
      redemptionUsdc: 0,
      clobEvents: 0,
      redemptionEvents: 0,
      totalEvents: 0,
      errors: [error.message],
    };
  }
}

// ============================================================================
// V12CashV2 - Fixed with CLOB deduplication and PositionsMerge
// ============================================================================

export interface CashRealizedPnlV2Result {
  wallet: string;
  realizedCash: number; // Total actual USDC flows (deduped)
  clobUsdc: number; // USDC from CLOB trades (deduped)
  redemptionUsdc: number; // USDC from PayoutRedemption
  mergeUsdc: number; // USDC from PositionsMerge (CTF redemptions)
  clobEvents: number;
  redemptionEvents: number;
  mergeEvents: number;
  totalEvents: number;
  errors: string[];
}

/**
 * V12CashV2: Fixed Dome-style cash flow calculator with:
 * 1. CLOB deduplication via GROUP BY event_id
 * 2. PositionsMerge included (CTF complete-set redemptions)
 *
 * Formula: deduped(CLOB usdc_delta) + PayoutRedemption usdc_delta + PositionsMerge usdc_delta
 *
 * This should provide better Dome parity than V12Cash.
 */
export async function calculateRealizedPnlV12CashV2(
  wallet: string
): Promise<CashRealizedPnlV2Result> {
  const ch = getClient();

  // Query with CLOB deduplication and all cash source types
  // Use lower() for case-insensitive matching
  const query = `
    WITH
      -- Dedupe CLOB events by event_id
      clob_deduped AS (
        SELECT
          event_id,
          any(usdc_delta) as usdc_delta
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower({wallet:String})
          AND source_type = 'CLOB'
        GROUP BY event_id
      ),
      -- Non-CLOB events don't need deduping (PayoutRedemption, PositionsMerge)
      non_clob AS (
        SELECT
          source_type,
          usdc_delta
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower({wallet:String})
          AND source_type IN ('PayoutRedemption', 'PositionsMerge')
      )
    SELECT
      -- CLOB deduped
      (SELECT coalesce(sum(usdc_delta), 0) FROM clob_deduped) as clob_usdc,
      (SELECT count() FROM clob_deduped) as clob_events,

      -- PayoutRedemption
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob WHERE source_type = 'PayoutRedemption') as redemption_usdc,
      (SELECT count() FROM non_clob WHERE source_type = 'PayoutRedemption') as redemption_events,

      -- PositionsMerge (CTF complete-set redemptions)
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob WHERE source_type = 'PositionsMerge') as merge_usdc,
      (SELECT count() FROM non_clob WHERE source_type = 'PositionsMerge') as merge_events,

      -- Total
      (SELECT coalesce(sum(usdc_delta), 0) FROM clob_deduped) +
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob) as realized_cash
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const clobEvents = Number(row.clob_events || 0);
    const redemptionEvents = Number(row.redemption_events || 0);
    const mergeEvents = Number(row.merge_events || 0);

    return {
      wallet,
      realizedCash: Number(row.realized_cash || 0),
      clobUsdc: Number(row.clob_usdc || 0),
      redemptionUsdc: Number(row.redemption_usdc || 0),
      mergeUsdc: Number(row.merge_usdc || 0),
      clobEvents,
      redemptionEvents,
      mergeEvents,
      totalEvents: clobEvents + redemptionEvents + mergeEvents,
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      realizedCash: 0,
      clobUsdc: 0,
      redemptionUsdc: 0,
      mergeUsdc: 0,
      clobEvents: 0,
      redemptionEvents: 0,
      mergeEvents: 0,
      totalEvents: 0,
      errors: [error.message],
    };
  }
}

// ============================================================================
// V12DomeCash - Strict Dome API Parity (CLOB dedup + PayoutRedemption ONLY)
// ============================================================================

export interface DomeCashResult {
  wallet: string;
  domeCash: number; // CLOB(dedup) + PayoutRedemption ONLY
  clobUsdc: number; // USDC from CLOB trades (deduped)
  redemptionUsdc: number; // USDC from PayoutRedemption
  clobEvents: number;
  redemptionEvents: number;
  totalEvents: number;
  errors: string[];
}

/**
 * V12DomeCash: Strict Dome API parity calculator.
 *
 * Definition: CLOB(dedup by event_id) + PayoutRedemption ONLY
 * - NO PositionsMerge (CTF complete-set redemptions)
 * - NO PositionSplit
 * - NO synthetic valuation
 *
 * This is the validator metric for external Dome API validation.
 * It intentionally excludes CTF operations that Dome doesn't count as realized.
 *
 * Use case: Validating our calculations against Dome API for wallets
 * that don't use CTF split/merge operations.
 */
export async function calculateRealizedPnlV12DomeCash(
  wallet: string
): Promise<DomeCashResult> {
  const ch = getClient();

  // Query with CLOB deduplication - PayoutRedemption ONLY (no Merge/Split)
  const query = `
    WITH
      -- Dedupe CLOB events by event_id
      clob_deduped AS (
        SELECT
          event_id,
          any(usdc_delta) as usdc_delta
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower({wallet:String})
          AND source_type = 'CLOB'
        GROUP BY event_id
      ),
      -- PayoutRedemption only (NO PositionsMerge)
      redemptions AS (
        SELECT usdc_delta
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower({wallet:String})
          AND source_type = 'PayoutRedemption'
      )
    SELECT
      -- CLOB deduped
      (SELECT coalesce(sum(usdc_delta), 0) FROM clob_deduped) as clob_usdc,
      (SELECT count() FROM clob_deduped) as clob_events,

      -- PayoutRedemption ONLY
      (SELECT coalesce(sum(usdc_delta), 0) FROM redemptions) as redemption_usdc,
      (SELECT count() FROM redemptions) as redemption_events,

      -- Total = CLOB + PayoutRedemption (strict Dome definition)
      (SELECT coalesce(sum(usdc_delta), 0) FROM clob_deduped) +
      (SELECT coalesce(sum(usdc_delta), 0) FROM redemptions) as dome_cash
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const clobEvents = Number(row.clob_events || 0);
    const redemptionEvents = Number(row.redemption_events || 0);

    return {
      wallet,
      domeCash: Number(row.dome_cash || 0),
      clobUsdc: Number(row.clob_usdc || 0),
      redemptionUsdc: Number(row.redemption_usdc || 0),
      clobEvents,
      redemptionEvents,
      totalEvents: clobEvents + redemptionEvents,
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      domeCash: 0,
      clobUsdc: 0,
      redemptionUsdc: 0,
      clobEvents: 0,
      redemptionEvents: 0,
      totalEvents: 0,
      errors: [error.message],
    };
  }
}

// ============================================================================
// V12CashFull - Complete Cash Ledger (CLOB + All CTF operations)
// ============================================================================

export interface CashFullResult {
  wallet: string;
  cashFull: number; // Total actual USDC flows (all sources)
  clobUsdc: number; // USDC from CLOB trades (deduped)
  redemptionUsdc: number; // USDC from PayoutRedemption
  mergeUsdc: number; // USDC from PositionsMerge (CTF redemptions)
  splitUsdc: number; // USDC from PositionSplit (CTF minting)
  clobEvents: number;
  redemptionEvents: number;
  mergeEvents: number;
  splitEvents: number;
  totalEvents: number;
  errors: string[];
}

/**
 * V12CashFull: Complete internal cash ledger including ALL CTF operations.
 *
 * Definition: CLOB(dedup) + PayoutRedemption + PositionsMerge + PositionSplit
 *
 * This provides the full picture of cash flows for internal analytics.
 * Note: PositionSplit is typically negative (paying USDC to mint tokens)
 * and PositionsMerge is typically positive (receiving USDC for burning tokens).
 *
 * Use case: Internal analytics, complete cash flow accounting.
 */
export async function calculateRealizedPnlV12CashFull(
  wallet: string
): Promise<CashFullResult> {
  const ch = getClient();

  const query = `
    WITH
      -- Dedupe CLOB events by event_id
      clob_deduped AS (
        SELECT
          event_id,
          any(usdc_delta) as usdc_delta
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower({wallet:String})
          AND source_type = 'CLOB'
        GROUP BY event_id
      ),
      -- All non-CLOB events (PayoutRedemption, PositionsMerge, PositionSplit)
      non_clob AS (
        SELECT
          source_type,
          usdc_delta
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower({wallet:String})
          AND source_type IN ('PayoutRedemption', 'PositionsMerge', 'PositionSplit')
      )
    SELECT
      -- CLOB deduped
      (SELECT coalesce(sum(usdc_delta), 0) FROM clob_deduped) as clob_usdc,
      (SELECT count() FROM clob_deduped) as clob_events,

      -- PayoutRedemption
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob WHERE source_type = 'PayoutRedemption') as redemption_usdc,
      (SELECT count() FROM non_clob WHERE source_type = 'PayoutRedemption') as redemption_events,

      -- PositionsMerge (CTF complete-set redemptions - positive USDC)
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob WHERE source_type = 'PositionsMerge') as merge_usdc,
      (SELECT count() FROM non_clob WHERE source_type = 'PositionsMerge') as merge_events,

      -- PositionSplit (CTF minting - negative USDC)
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob WHERE source_type = 'PositionSplit') as split_usdc,
      (SELECT count() FROM non_clob WHERE source_type = 'PositionSplit') as split_events,

      -- Total = ALL cash flows
      (SELECT coalesce(sum(usdc_delta), 0) FROM clob_deduped) +
      (SELECT coalesce(sum(usdc_delta), 0) FROM non_clob) as cash_full
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const clobEvents = Number(row.clob_events || 0);
    const redemptionEvents = Number(row.redemption_events || 0);
    const mergeEvents = Number(row.merge_events || 0);
    const splitEvents = Number(row.split_events || 0);

    return {
      wallet,
      cashFull: Number(row.cash_full || 0),
      clobUsdc: Number(row.clob_usdc || 0),
      redemptionUsdc: Number(row.redemption_usdc || 0),
      mergeUsdc: Number(row.merge_usdc || 0),
      splitUsdc: Number(row.split_usdc || 0),
      clobEvents,
      redemptionEvents,
      mergeEvents,
      splitEvents,
      totalEvents: clobEvents + redemptionEvents + mergeEvents + splitEvents,
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      cashFull: 0,
      clobUsdc: 0,
      redemptionUsdc: 0,
      mergeUsdc: 0,
      splitUsdc: 0,
      clobEvents: 0,
      redemptionEvents: 0,
      mergeEvents: 0,
      splitEvents: 0,
      totalEvents: 0,
      errors: [error.message],
    };
  }
}

// ============================================================================
// Batch Calculation
// ============================================================================

/**
 * Calculate cash-only realized PnL for multiple wallets.
 */
export async function batchCalculateRealizedPnlV12Cash(
  wallets: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<CashRealizedPnlResult[]> {
  const results: CashRealizedPnlResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const result = await calculateRealizedPnlV12Cash(wallets[i]);
    results.push(result);
    if (onProgress) {
      onProgress(i + 1, wallets.length);
    }
  }

  return results;
}

// ============================================================================
// Detailed Stats (for diagnostics)
// ============================================================================

/**
 * Get detailed cash realized PnL stats for a wallet.
 * Includes condition-level breakdown showing redeemed vs unredeemed.
 */
export async function getCashRealizedStats(
  wallet: string
): Promise<CashRealizedStats> {
  const ch = getClient();

  const query = `
    SELECT
      -- USDC breakdown by source
      sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,
      sum(
        CASE
          WHEN source_type IN ('CLOB', 'PayoutRedemption') THEN usdc_delta
          ELSE 0
        END
      ) as realized_cash,

      -- Event counts
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events,
      count() as total_events,

      -- Condition-level breakdown
      countDistinct(condition_id) as unique_conditions,

      -- Resolved conditions (have payout_numerators)
      countDistinct(
        if(payout_numerators IS NOT NULL AND payout_numerators != '', condition_id, NULL)
      ) as resolved_conditions,

      -- Redeemed conditions (have PayoutRedemption event)
      countDistinct(
        if(source_type = 'PayoutRedemption', condition_id, NULL)
      ) as redeemed_conditions

    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address = {wallet:String}
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const resolvedConditions = Number(row.resolved_conditions || 0);
    const redeemedConditions = Number(row.redeemed_conditions || 0);

    return {
      wallet,
      realizedCash: Number(row.realized_cash || 0),
      clobUsdc: Number(row.clob_usdc || 0),
      redemptionUsdc: Number(row.redemption_usdc || 0),
      clobEvents: Number(row.clob_events || 0),
      redemptionEvents: Number(row.redemption_events || 0),
      totalEvents: Number(row.total_events || 0),
      uniqueConditions: Number(row.unique_conditions || 0),
      resolvedConditions,
      redeemedConditions,
      unredeemedResolvedConditions: Math.max(0, resolvedConditions - redeemedConditions),
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      realizedCash: 0,
      clobUsdc: 0,
      redemptionUsdc: 0,
      clobEvents: 0,
      redemptionEvents: 0,
      totalEvents: 0,
      uniqueConditions: 0,
      resolvedConditions: 0,
      redeemedConditions: 0,
      unredeemedResolvedConditions: 0,
      errors: [error.message],
    };
  }
}

// ============================================================================
// Comparison Helpers
// ============================================================================

/**
 * Calculate the "synthetic gap" between V12Cash and what V12 would report.
 *
 * The gap represents unredeemed shares valued at resolution that V12 counts
 * but V12Cash does not (because they haven't been redeemed yet).
 *
 * This helps explain Dome discrepancies:
 * - If gap > 0: Wallet has unredeemed winning shares
 * - If gap = 0: Wallet has redeemed all winning shares (or has none)
 */
export async function calculateSyntheticGap(
  wallet: string
): Promise<{
  v12Cash: number;
  v12Synthetic: number;
  gap: number;
  gapPct: number;
}> {
  const ch = getClient();

  // Get V12Cash (actual cash flows)
  const cashResult = await calculateRealizedPnlV12Cash(wallet);

  // Get V12 synthetic (includes unredeemed share value)
  // This uses the V8 ledger approach to get equivalent of V12
  const syntheticQuery = `
    SELECT
      sum(
        CASE
          WHEN source_type = 'CLOB' THEN
            CASE
              WHEN payout_numerators IS NOT NULL AND payout_numerators != '' THEN
                usdc_delta + (token_delta * coalesce(payout_norm, 0))
              ELSE 0
            END
          WHEN source_type = 'PayoutRedemption' THEN usdc_delta
          ELSE 0
        END
      ) as v12_synthetic
    FROM pm_unified_ledger_v8_tbl
    WHERE wallet_address = {wallet:String}
  `;

  try {
    const result = await ch.query({
      query: syntheticQuery,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const v12Cash = cashResult.realizedCash;
    const v12Synthetic = Number(row.v12_synthetic || 0);
    const gap = v12Synthetic - v12Cash;
    const gapPct = v12Cash !== 0 ? Math.abs(gap / v12Cash) * 100 : 0;

    return {
      v12Cash,
      v12Synthetic,
      gap,
      gapPct,
    };
  } catch {
    return {
      v12Cash: cashResult.realizedCash,
      v12Synthetic: 0,
      gap: 0,
      gapPct: 0,
    };
  }
}
