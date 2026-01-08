/**
 * ============================================================================
 * TOTAL PNL ENGINE V1
 * ============================================================================
 *
 * Combines V12 Synthetic Realized + Unrealized for complete profit/loss picture.
 *
 * Formula:
 *   total_pnl = v12_realized + unrealized
 *
 * Where:
 * - v12_realized: Trade-level realized PnL from V12 engine (CLOB + CTF events)
 * - unrealized: Mark-to-market of open positions (from unrealizedPnlV1.ts)
 *
 * This should match Polymarket UI "Net Total" for Tier A Comparable wallets
 * with low unresolved positions.
 *
 * Terminal: Claude 2
 * Date: 2025-12-10
 *
 * UPDATED: Switched from Dome-Strict to V12 Synthetic
 * - Dome-Strict used sum(usdc_delta) which measures cash turnover, not profit
 * - V12 uses proper trade-level accounting with cost basis tracking
 * - V12 achieves 82.6% pass rate vs UI at 20% tolerance
 */

import {
  calculateRealizedPnlV12,
  RealizedPnlResult,
  closeClient as closeV12Client,
} from './realizedPnlV12';
import {
  calculateUnrealizedPnl,
  UnrealizedResult,
  closeClient as closeUnrealizedClient,
} from './unrealizedPnlV1';

// ============================================================================
// Types
// ============================================================================

export interface V12RealizedResult {
  wallet: string;
  realizedPnl: number;
  eventCount: number;
  resolvedEvents: number;
  unresolvedEvents: number;
  unresolvedPct: number;
  isComparable: boolean;
  errors: string[];
}

export interface TotalPnlResult {
  wallet: string;
  totalPnl: number;
  breakdown: {
    realizedPnl: number;
    unrealizedPnl: number;
  };
  realized: V12RealizedResult;
  unrealized: UnrealizedResult;
  errors: string[];
}

export interface TotalPnlBatchResult {
  results: TotalPnlResult[];
  summary: {
    totalWallets: number;
    successfulWallets: number;
    avgTotalPnl: number;
    avgRealizedPnl: number;
    avgUnrealizedPnl: number;
    totalPnlSum: number;
  };
}

// ============================================================================
// V12 Realized Calculation
// ============================================================================

/**
 * Calculate V12 Synthetic Realized PnL for a wallet.
 *
 * Uses the V12 SQL-based engine which:
 * - Sources from pm_trader_events_v3 (CLOB trades)
 * - Deduplicates with GROUP BY event_id
 * - Joins token mapping and resolutions
 * - Formula: realized_pnl = usdc_delta + token_delta * payout_norm
 *
 * This is the CORRECT V12 engine that achieves 82.6% pass rate at 20% tolerance.
 */
async function calculateV12Realized(wallet: string): Promise<V12RealizedResult> {
  try {
    const result: RealizedPnlResult = await calculateRealizedPnlV12(wallet);

    return {
      wallet: wallet.toLowerCase(),
      realizedPnl: result.realizedPnl,
      eventCount: result.eventCount,
      resolvedEvents: result.resolvedEvents,
      unresolvedEvents: result.unresolvedEvents,
      unresolvedPct: result.unresolvedPct,
      isComparable: result.isComparable,
      errors: result.errors,
    };
  } catch (error: any) {
    return {
      wallet: wallet.toLowerCase(),
      realizedPnl: 0,
      eventCount: 0,
      resolvedEvents: 0,
      unresolvedEvents: 0,
      unresolvedPct: 0,
      isComparable: false,
      errors: [error.message],
    };
  }
}

// ============================================================================
// Main Calculation
// ============================================================================

/**
 * Calculate Total PnL for a wallet.
 *
 * Combines:
 * 1. V12 Synthetic Realized (trade-level P&L with proper cost basis)
 * 2. Unrealized (mark-to-market of open positions)
 */
export async function calculateTotalPnl(wallet: string): Promise<TotalPnlResult> {
  const errors: string[] = [];

  // Calculate realized (V12 Synthetic)
  const realized = await calculateV12Realized(wallet);
  if (realized.errors.length > 0) {
    errors.push(...realized.errors.map((e) => `[Realized] ${e}`));
  }

  // Calculate unrealized
  const unrealized = await calculateUnrealizedPnl(wallet);
  if (unrealized.errors.length > 0) {
    errors.push(...unrealized.errors.map((e) => `[Unrealized] ${e}`));
  }

  // Total = Realized + Unrealized
  const totalPnl = realized.realizedPnl + unrealized.unrealizedPnl;

  return {
    wallet: wallet.toLowerCase(),
    totalPnl,
    breakdown: {
      realizedPnl: realized.realizedPnl,
      unrealizedPnl: unrealized.unrealizedPnl,
    },
    realized,
    unrealized,
    errors,
  };
}

// ============================================================================
// Batch Calculation
// ============================================================================

/**
 * Calculate Total PnL for multiple wallets.
 */
export async function batchCalculateTotalPnl(
  wallets: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<TotalPnlBatchResult> {
  const results: TotalPnlResult[] = [];
  let successCount = 0;
  let sumTotal = 0;
  let sumRealized = 0;
  let sumUnrealized = 0;

  for (let i = 0; i < wallets.length; i++) {
    try {
      const result = await calculateTotalPnl(wallets[i]);
      results.push(result);

      // Only count as success if no major errors
      if (result.realized.errors.length === 0) {
        successCount++;
        sumTotal += result.totalPnl;
        sumRealized += result.breakdown.realizedPnl;
        sumUnrealized += result.breakdown.unrealizedPnl;
      }
    } catch (error: any) {
      results.push({
        wallet: wallets[i].toLowerCase(),
        totalPnl: 0,
        breakdown: { realizedPnl: 0, unrealizedPnl: 0 },
        realized: {
          wallet: wallets[i].toLowerCase(),
          realizedPnl: 0,
          eventCount: 0,
          resolvedEvents: 0,
          unresolvedEvents: 0,
          unresolvedPct: 0,
          isComparable: false,
          errors: [error.message],
        },
        unrealized: {
          wallet: wallets[i].toLowerCase(),
          unrealizedPnl: 0,
          positions: [],
          stats: {
            totalPositions: 0,
            totalCostBasis: 0,
            totalMarketValue: 0,
            unresolvedConditions: 0,
          },
          pricesFetchedAt: new Date(),
          errors: [error.message],
        },
        errors: [error.message],
      });
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
      avgTotalPnl: successCount > 0 ? sumTotal / successCount : 0,
      avgRealizedPnl: successCount > 0 ? sumRealized / successCount : 0,
      avgUnrealizedPnl: successCount > 0 ? sumUnrealized / successCount : 0,
      totalPnlSum: sumTotal,
    },
  };
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Close all database connections.
 */
export async function closeAllClients(): Promise<void> {
  await closeV12Client();
  await closeUnrealizedClient();
}

// ============================================================================
// Comparison with UI
// ============================================================================

export interface UiComparisonResult {
  wallet: string;
  cascadianTotal: number;
  uiTotal: number | null;
  delta: number | null;
  deltaPct: number | null;
  withinTolerance: boolean;
  breakdown: {
    cascadianRealized: number;
    cascadianUnrealized: number;
  };
}

/**
 * Compare Cascadian Total PnL against UI tooltip value.
 */
export function compareToUi(
  result: TotalPnlResult,
  uiTotal: number | null,
  tolerance: number = 0.10
): UiComparisonResult {
  if (uiTotal === null) {
    return {
      wallet: result.wallet,
      cascadianTotal: result.totalPnl,
      uiTotal: null,
      delta: null,
      deltaPct: null,
      withinTolerance: false,
      breakdown: {
        cascadianRealized: result.breakdown.realizedPnl,
        cascadianUnrealized: result.breakdown.unrealizedPnl,
      },
    };
  }

  const delta = result.totalPnl - uiTotal;
  const deltaPct = Math.abs(delta) / Math.max(Math.abs(uiTotal), 1);
  const withinTolerance = deltaPct <= tolerance;

  return {
    wallet: result.wallet,
    cascadianTotal: result.totalPnl,
    uiTotal,
    delta,
    deltaPct,
    withinTolerance,
    breakdown: {
      cascadianRealized: result.breakdown.realizedPnl,
      cascadianUnrealized: result.breakdown.unrealizedPnl,
    },
  };
}
