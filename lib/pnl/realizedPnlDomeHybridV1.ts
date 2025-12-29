/**
 * ============================================================================
 * DOME HYBRID REALIZED PNL ENGINE V1
 * ============================================================================
 *
 * Hybrid approach for Dome parity:
 * - CLOB cash from V9 CLOB ledger (best fill coverage)
 * - Redemption cash from V8 Full ledger (PayoutRedemption events)
 *
 * This addresses the 20% accuracy issue with Dome-Strict:
 * - V8 Full may be missing some CLOB fills
 * - V9 CLOB has better CLOB coverage but no redemption events
 * - Combining both should give best parity with Dome API
 *
 * Formula:
 *   dome_hybrid_realized = clob_cash_v9 + redemption_cash_v8
 *
 * Terminal: Claude 2
 * Date: 2025-12-09
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { CANONICAL_TABLES, getLedgerForSurface } from './canonicalTables';

// ============================================================================
// Types
// ============================================================================

export interface DomeHybridResult {
  wallet: string;
  realizedPnl: number;
  breakdown: {
    clobCashV9: number;      // CLOB cash from V9 CLOB ledger
    redemptionCashV8: number; // Redemption cash from V8 Full ledger
  };
  eventCounts: {
    clobEventsV9: number;
    redemptionEventsV8: number;
    total: number;
  };
  sourceTables: {
    clob: string;
    redemption: string;
  };
  errors: string[];
}

export interface DomeHybridBatchResult {
  results: DomeHybridResult[];
  summary: {
    totalWallets: number;
    successfulWallets: number;
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

export async function closeClient(): Promise<void> {
  if (chClient) {
    const client = chClient;
    chClient = null;
    await client.close();
  }
}

// ============================================================================
// Core Calculation - Dome Hybrid Formula
// ============================================================================

/**
 * Calculate Dome-Hybrid realized PnL for a single wallet.
 *
 * Uses:
 * - V9 CLOB ledger for CLOB trade cash
 * - V8 Full ledger for PayoutRedemption cash
 *
 * This hybrid approach should give better Dome API parity because:
 * - V9 CLOB has the most complete CLOB fill data
 * - V8 Full has the redemption events that V9 CLOB doesn't include
 */
export async function calculateDomeHybridRealized(
  wallet: string
): Promise<DomeHybridResult> {
  const ch = getClient();
  const clobLedger = getLedgerForSurface('leaderboard_v1_clob'); // V9 CLOB
  const fullLedger = getLedgerForSurface('full_pnl'); // V8 Full

  // Query 1: Get CLOB cash from V9
  const clobQuery = `
    SELECT
      sum(usdc_delta) as clob_cash,
      count() as clob_events
    FROM ${clobLedger}
    WHERE lower(wallet_address) = {wallet:String}
      AND condition_id != ''
  `;

  // Query 2: Get Redemption cash from V8
  const redemptionQuery = `
    SELECT
      sum(usdc_delta) as redemption_cash,
      count() as redemption_events
    FROM ${fullLedger}
    WHERE lower(wallet_address) = {wallet:String}
      AND source_type = 'PayoutRedemption'
      AND condition_id != ''
  `;

  const errors: string[] = [];
  let clobCash = 0;
  let clobEvents = 0;
  let redemptionCash = 0;
  let redemptionEvents = 0;

  try {
    // Execute queries in parallel
    const [clobResult, redemptionResult] = await Promise.all([
      ch.query({
        query: clobQuery,
        query_params: { wallet: wallet.toLowerCase() },
        format: 'JSONEachRow',
      }),
      ch.query({
        query: redemptionQuery,
        query_params: { wallet: wallet.toLowerCase() },
        format: 'JSONEachRow',
      }),
    ]);

    const clobRows = await clobResult.json() as Array<{ clob_cash: number; clob_events: number }>;
    const redemptionRows = await redemptionResult.json() as Array<{ redemption_cash: number; redemption_events: number }>;

    if (clobRows[0]) {
      clobCash = Number(clobRows[0].clob_cash || 0);
      clobEvents = Number(clobRows[0].clob_events || 0);
    }

    if (redemptionRows[0]) {
      redemptionCash = Number(redemptionRows[0].redemption_cash || 0);
      redemptionEvents = Number(redemptionRows[0].redemption_events || 0);
    }
  } catch (error: any) {
    errors.push(error.message);
  }

  const totalRealized = clobCash + redemptionCash;

  return {
    wallet: wallet.toLowerCase(),
    realizedPnl: totalRealized,
    breakdown: {
      clobCashV9: clobCash,
      redemptionCashV8: redemptionCash,
    },
    eventCounts: {
      clobEventsV9: clobEvents,
      redemptionEventsV8: redemptionEvents,
      total: clobEvents + redemptionEvents,
    },
    sourceTables: {
      clob: clobLedger,
      redemption: fullLedger,
    },
    errors,
  };
}

// ============================================================================
// Batch Calculation
// ============================================================================

/**
 * Calculate Dome-Hybrid realized PnL for multiple wallets.
 */
export async function batchCalculateDomeHybrid(
  wallets: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<DomeHybridBatchResult> {
  const results: DomeHybridResult[] = [];
  let successCount = 0;
  let totalPnl = 0;

  for (let i = 0; i < wallets.length; i++) {
    const result = await calculateDomeHybridRealized(wallets[i]);
    results.push(result);

    if (result.errors.length === 0) {
      successCount++;
      totalPnl += result.realizedPnl;
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
      avgRealizedPnl: successCount > 0 ? totalPnl / successCount : 0,
      totalRealizedPnl: totalPnl,
    },
  };
}

// ============================================================================
// Dome API Comparison
// ============================================================================

export interface DomeHybridComparisonResult {
  wallet: string;
  cascadianRealized: number;
  domeRealized: number | null;
  delta: number | null;
  deltaPct: number | null;
  withinTolerance: boolean;
  domeHasCoverage: boolean;
  breakdown: {
    clobCashV9: number;
    redemptionCashV8: number;
  };
}

/**
 * Compare Dome-Hybrid calculation against Dome API.
 */
export function compareToDome(
  result: DomeHybridResult,
  domeValue: number | null,
  tolerance: number = 0.10
): DomeHybridComparisonResult {
  const domeHasCoverage = domeValue !== null && domeValue !== 0;

  if (!domeHasCoverage) {
    return {
      wallet: result.wallet,
      cascadianRealized: result.realizedPnl,
      domeRealized: domeValue,
      delta: null,
      deltaPct: null,
      withinTolerance: false,
      domeHasCoverage: false,
      breakdown: result.breakdown,
    };
  }

  const delta = result.realizedPnl - domeValue!;
  const deltaPct = Math.abs(delta) / Math.max(Math.abs(domeValue!), 1);
  const withinTolerance = deltaPct <= tolerance;

  return {
    wallet: result.wallet,
    cascadianRealized: result.realizedPnl,
    domeRealized: domeValue,
    delta,
    deltaPct,
    withinTolerance,
    domeHasCoverage: true,
    breakdown: result.breakdown,
  };
}

// ============================================================================
// Deep Trace (for debugging)
// ============================================================================

export interface DeepTraceResult {
  wallet: string;
  hybrid: DomeHybridResult;
  domeApi: {
    realizedPnl: number | null;
    hasCoverage: boolean;
  };
  comparison: {
    delta: number | null;
    deltaPct: number | null;
    withinTolerance: boolean;
  };
  componentAnalysis: {
    clobContribution: number; // % of total from CLOB
    redemptionContribution: number; // % of total from redemptions
  };
}

/**
 * Generate detailed trace for a wallet, useful for debugging discrepancies.
 */
export async function deepTrace(
  wallet: string,
  domeValue: number | null
): Promise<DeepTraceResult> {
  const hybrid = await calculateDomeHybridRealized(wallet);
  const comparison = compareToDome(hybrid, domeValue);

  const total = Math.abs(hybrid.breakdown.clobCashV9) + Math.abs(hybrid.breakdown.redemptionCashV8);
  const clobContribution = total > 0 ? Math.abs(hybrid.breakdown.clobCashV9) / total : 0;
  const redemptionContribution = total > 0 ? Math.abs(hybrid.breakdown.redemptionCashV8) / total : 0;

  return {
    wallet: wallet.toLowerCase(),
    hybrid,
    domeApi: {
      realizedPnl: domeValue,
      hasCoverage: domeValue !== null && domeValue !== 0,
    },
    comparison: {
      delta: comparison.delta,
      deltaPct: comparison.deltaPct,
      withinTolerance: comparison.withinTolerance,
    },
    componentAnalysis: {
      clobContribution,
      redemptionContribution,
    },
  };
}
