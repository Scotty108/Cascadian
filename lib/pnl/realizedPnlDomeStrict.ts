/**
 * ============================================================================
 * DOME-STRICT REALIZED PNL ENGINE
 * ============================================================================
 *
 * Definition: dome_strict_realized = sum of ALL cash movements
 *
 * This is the conservative, blockchain-verifiable realized PnL:
 * - Cash spent on trades (negative)
 * - Cash received from trades (positive)
 * - Cash received from redemptions (positive)
 *
 * DOES NOT INCLUDE:
 * - Unredeemed winning positions (that's "synthetic" territory)
 * - Mark-to-market value of open positions (that's "unrealized")
 *
 * This should match Dome API's realized PnL for wallets with full coverage.
 *
 * Terminal: Claude 2
 * Date: 2025-12-09
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { CANONICAL_TABLES, getLedgerForSurface } from './canonicalTables';

// ============================================================================
// Types
// ============================================================================

export interface DomeStrictResult {
  wallet: string;
  realizedPnl: number;
  breakdown: {
    clobCash: number;        // Cash from CLOB trades
    redemptionCash: number;  // Cash from PayoutRedemption events
    otherCash: number;       // Cash from other event types (CTF, etc.)
  };
  eventCounts: {
    clobEvents: number;
    redemptionEvents: number;
    otherEvents: number;
    total: number;
  };
  conditionStats: {
    totalConditions: number;
    resolvedConditions: number;
    unresolvedConditions: number;
  };
  isComplete: boolean;  // true if all traded markets are resolved
  errors: string[];
}

export interface DomeStrictBatchResult {
  results: DomeStrictResult[];
  summary: {
    totalWallets: number;
    successfulWallets: number;
    failedWallets: number;
    avgRealizedPnl: number;
    totalRealizedPnl: number;
  };
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
// Core Calculation - Dome Strict Formula
// ============================================================================

/**
 * Calculate Dome-strict realized PnL for a single wallet.
 *
 * Uses the canonical full ledger (V8) which includes all event types:
 * CLOB trades + PayoutRedemption + CTF events.
 *
 * Formula: dome_strict = sum(usdc_delta) across all events
 */
export async function calculateDomeStrictRealized(
  wallet: string
): Promise<DomeStrictResult> {
  const ch = getClient();
  const ledger = getLedgerForSurface('full_pnl');

  const query = `
    WITH
      -- Ledger aggregation
      ledger_agg AS (
        SELECT
          -- Cash by source type
          sum(usdc_delta) as total_cash,
          sumIf(usdc_delta, source_type = 'CLOB') as clob_cash,
          sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_cash,
          sumIf(usdc_delta, source_type NOT IN ('CLOB', 'PayoutRedemption')) as other_cash,

          -- Event counts by source type
          count() as total_events,
          countIf(source_type = 'CLOB') as clob_events,
          countIf(source_type = 'PayoutRedemption') as redemption_events,
          countIf(source_type NOT IN ('CLOB', 'PayoutRedemption')) as other_events,

          -- Condition tracking
          countDistinct(condition_id) as total_conditions
        FROM ${ledger}
        WHERE lower(wallet_address) = {wallet:String}
          AND condition_id != ''
      ),
      -- Resolution status
      resolution_status AS (
        SELECT
          countDistinct(l.condition_id) as resolved_conditions
        FROM ${ledger} l
        INNER JOIN ${CANONICAL_TABLES.RESOLUTIONS} r ON l.condition_id = r.condition_id
        WHERE lower(l.wallet_address) = {wallet:String}
          AND l.condition_id != ''
          AND r.payout_numerators IS NOT NULL
          AND r.payout_numerators != ''
      )
    SELECT
      la.total_cash,
      la.clob_cash,
      la.redemption_cash,
      la.other_cash,
      la.total_events,
      la.clob_events,
      la.redemption_events,
      la.other_events,
      la.total_conditions,
      rs.resolved_conditions
    FROM ledger_agg la
    CROSS JOIN resolution_status rs
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = (rows[0] || {}) as Record<string, any>;

    const totalConditions = Number(row.total_conditions || 0);
    const resolvedConditions = Number(row.resolved_conditions || 0);
    const unresolvedConditions = totalConditions - resolvedConditions;

    return {
      wallet: wallet.toLowerCase(),
      realizedPnl: Number(row.total_cash || 0),
      breakdown: {
        clobCash: Number(row.clob_cash || 0),
        redemptionCash: Number(row.redemption_cash || 0),
        otherCash: Number(row.other_cash || 0),
      },
      eventCounts: {
        clobEvents: Number(row.clob_events || 0),
        redemptionEvents: Number(row.redemption_events || 0),
        otherEvents: Number(row.other_events || 0),
        total: Number(row.total_events || 0),
      },
      conditionStats: {
        totalConditions,
        resolvedConditions,
        unresolvedConditions,
      },
      isComplete: unresolvedConditions === 0,
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet: wallet.toLowerCase(),
      realizedPnl: 0,
      breakdown: { clobCash: 0, redemptionCash: 0, otherCash: 0 },
      eventCounts: { clobEvents: 0, redemptionEvents: 0, otherEvents: 0, total: 0 },
      conditionStats: { totalConditions: 0, resolvedConditions: 0, unresolvedConditions: 0 },
      isComplete: false,
      errors: [error.message],
    };
  }
}

// ============================================================================
// Batch Calculation
// ============================================================================

/**
 * Calculate Dome-strict realized PnL for multiple wallets.
 */
export async function batchCalculateDomeStrict(
  wallets: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<DomeStrictBatchResult> {
  const results: DomeStrictResult[] = [];
  let successCount = 0;
  let failCount = 0;
  let totalPnl = 0;

  for (let i = 0; i < wallets.length; i++) {
    const result = await calculateDomeStrictRealized(wallets[i]);
    results.push(result);

    if (result.errors.length === 0) {
      successCount++;
      totalPnl += result.realizedPnl;
    } else {
      failCount++;
    }

    if (onProgress) {
      onProgress(i + 1, wallets.length);
    }
  }

  return {
    results,
    summary: {
      totalWallets: wallets.length,
      successfulWallets: successCount,
      failedWallets: failCount,
      avgRealizedPnl: successCount > 0 ? totalPnl / successCount : 0,
      totalRealizedPnl: totalPnl,
    },
  };
}

// ============================================================================
// Dome API Comparison
// ============================================================================

export interface DomeComparisonResult {
  wallet: string;
  cascadianRealized: number;
  domeRealized: number | null;
  delta: number | null;
  deltaPct: number | null;
  withinTolerance: boolean;
  domeHasCoverage: boolean;
  toleranceUsed: number;
}

/**
 * Compare Cascadian Dome-strict calculation against Dome API.
 *
 * @param wallet - Wallet address to compare
 * @param domeValue - Value from Dome API (null if no coverage)
 * @param tolerance - Tolerance percentage (default 10%)
 */
export function compareToDome(
  cascadianResult: DomeStrictResult,
  domeValue: number | null,
  tolerance: number = 0.10
): DomeComparisonResult {
  const cascadianRealized = cascadianResult.realizedPnl;
  const domeHasCoverage = domeValue !== null && domeValue !== 0;

  if (!domeHasCoverage) {
    return {
      wallet: cascadianResult.wallet,
      cascadianRealized,
      domeRealized: domeValue,
      delta: null,
      deltaPct: null,
      withinTolerance: false,
      domeHasCoverage: false,
      toleranceUsed: tolerance,
    };
  }

  const delta = cascadianRealized - domeValue!;
  const deltaPct = Math.abs(delta) / Math.max(Math.abs(domeValue!), 1);
  const withinTolerance = deltaPct <= tolerance;

  return {
    wallet: cascadianResult.wallet,
    cascadianRealized,
    domeRealized: domeValue,
    delta,
    deltaPct,
    withinTolerance,
    domeHasCoverage: true,
    toleranceUsed: tolerance,
  };
}
