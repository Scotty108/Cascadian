/**
 * ============================================================================
 * PNL ROUTER - Production Wallet PnL API
 * ============================================================================
 *
 * Single entry point for the app to get a wallet's displayable PnL and label.
 *
 * IMPORTANT:
 * - This router ONLY uses V29 UiParity as the canonical engine
 * - V23c/V23d are research/backup engines, NOT production
 * - All classification and display logic flows through this module
 *
 * FLOW:
 * V8 Ledger -> V29 Engine -> V29CanonicalPnL -> classifyCohort -> pnlRouter -> UI
 *
 * Terminal: Claude 1 (Main Terminal)
 * Date: 2025-12-06
 */

import { getV29CanonicalPnL, V29CanonicalPnL } from './inventoryEngineV29';
import {
  classifyCohort,
  WalletCohort,
  CohortDecision,
  WalletTags,
  getCohortDisplayLabel,
  shouldDisplayPnL,
  getCohortConfidence,
} from './cohortClassifier';
import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

/**
 * Production PnL display result.
 *
 * This is what the UI receives - everything needed to render PnL correctly.
 */
export interface WalletPnlDisplay {
  wallet: string;

  /** Engine identifier (always V29_UIPARITY for production) */
  canonicalEngine: 'V29_UIPARITY';

  /** Cohort classification */
  cohort: WalletCohort;

  /** Human-readable reason for cohort assignment */
  cohortReason: string;

  /** PnL value to display (0 if SUSPECT) */
  displayPnL: number;

  /** Label for the PnL display (e.g., "PnL (precise)", "PnL (estimate)") */
  displayLabel: string;

  /** Confidence level (0-1) based on cohort */
  confidence: number;

  /** Whether PnL should be shown at all */
  shouldDisplay: boolean;

  /** Debug/audit information (not for public display) */
  debug?: {
    uiPnL: number;
    realizedPnL: number;
    unrealizedPnL: number;
    resolvedUnredeemedValue: number;
    eventsProcessed: number;
    dataHealth: V29CanonicalPnL['dataHealth'];
    tags?: WalletTags;
  };
}

/**
 * Router options.
 */
export interface RouterOptions {
  /** Include debug info in response (default: false) */
  includeDebug?: boolean;

  /** Skip tagging for faster response (uses minimal tags) (default: false) */
  skipTagging?: boolean;

  /** Custom UI benchmark PnL for error calculation (default: not set) */
  uiBenchmarkPnL?: number;
}

// ============================================================================
// Tag Loader (matches regression harness logic)
// ============================================================================

/**
 * Load wallet tags from ClickHouse.
 *
 * This mirrors the tagWallet function in run-regression-matrix.ts.
 */
async function loadWalletTags(wallet: string): Promise<WalletTags> {
  // Get CTF activity counts
  const ctfQuery = await clickhouse.query({
    query: `
      SELECT
        countIf(source_type = 'CLOB') as clob_count,
        countIf(source_type = 'PositionSplit') as split_count,
        countIf(source_type = 'PositionsMerge') as merge_count
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
    `,
    format: 'JSONEachRow',
  });
  const ctfRows = (await ctfQuery.json()) as any[];
  const ctf = ctfRows[0] || { clob_count: 0, split_count: 0, merge_count: 0 };

  const clobCount = Number(ctf.clob_count);
  const splitCount = Number(ctf.split_count);
  const mergeCount = Number(ctf.merge_count);

  // Calculate inventory mismatch (sold more than bought via CLOB)
  const invQuery = await clickhouse.query({
    query: `
      WITH position_totals AS (
        SELECT
          condition_id,
          outcome_index,
          sum(token_delta) as net_tokens
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
        GROUP BY condition_id, outcome_index
      )
      SELECT
        sum(CASE WHEN net_tokens < -5 THEN abs(net_tokens) ELSE 0 END) as inventory_mismatch
      FROM position_totals
    `,
    format: 'JSONEachRow',
  });
  const invRows = (await invQuery.json()) as any[];
  const inventoryMismatch = Number(invRows[0]?.inventory_mismatch || 0);

  // Check for missing resolutions
  const resQuery = await clickhouse.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT condition_id
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
      ),
      resolved AS (
        SELECT DISTINCT condition_id
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      )
      SELECT
        count() as total,
        countIf(r.condition_id IS NULL) as missing
      FROM wallet_conditions wc
      LEFT JOIN resolved r ON lower(wc.condition_id) = lower(r.condition_id)
    `,
    format: 'JSONEachRow',
  });
  const resRows = (await resQuery.json()) as any[];
  const missingResolutions = Number(resRows[0]?.missing || 0);

  // Classify wallet
  const isTraderStrict = splitCount === 0 && mergeCount === 0 && inventoryMismatch < 5;
  const isMakerHeavy = mergeCount > 10 || splitCount > 10;
  const isMixed = !isTraderStrict && !isMakerHeavy;
  const isDataSuspect = inventoryMismatch > 100 || (clobCount === 0 && mergeCount > 0);

  return {
    isTraderStrict,
    isMixed,
    isMakerHeavy,
    isDataSuspect,
    splitCount,
    mergeCount,
    clobCount,
    inventoryMismatch,
    missingResolutions,
  };
}

/**
 * Create minimal tags when skipTagging is enabled.
 */
function createMinimalTags(): WalletTags {
  return {
    isTraderStrict: false,
    isMixed: true,  // Default to MIXED for unknown
    isMakerHeavy: false,
    isDataSuspect: false,
    splitCount: 0,
    mergeCount: 0,
    clobCount: 0,
    inventoryMismatch: 0,
    missingResolutions: 0,
  };
}

// ============================================================================
// Main Router Function
// ============================================================================

/**
 * Get wallet PnL for production display.
 *
 * This is the PRIMARY function for the app to call.
 *
 * @param wallet - The wallet address
 * @param options - Router options
 * @returns WalletPnlDisplay with all fields for UI rendering
 */
export async function getWalletPnlDisplay(
  wallet: string,
  options: RouterOptions = {}
): Promise<WalletPnlDisplay> {
  const { includeDebug = false, skipTagging = false, uiBenchmarkPnL } = options;

  // Step 1: Get V29 canonical PnL
  const canonicalPnL = await getV29CanonicalPnL(wallet);

  // Step 2: Get wallet tags (or use minimal if skipping)
  const tags = skipTagging ? createMinimalTags() : await loadWalletTags(wallet);

  // Step 3: Calculate error % if we have a benchmark
  let uiParityErrorPct = 0;
  if (uiBenchmarkPnL !== undefined && uiBenchmarkPnL !== 0) {
    uiParityErrorPct = Math.abs((canonicalPnL.uiPnL - uiBenchmarkPnL) / Math.abs(uiBenchmarkPnL)) * 100;
  }

  // Step 4: Classify cohort
  const cohortDecision = classifyCohort({
    pnl: canonicalPnL,
    tags,
    uiParityErrorPct,
    timedOut: false,
  });

  // Step 5: Build display result
  const displayLabel = getCohortDisplayLabel(cohortDecision.cohort);
  const shouldDisplay = shouldDisplayPnL(cohortDecision.cohort);
  const confidence = getCohortConfidence(cohortDecision.cohort);

  // For SUSPECT wallets, we hide the PnL (set to 0)
  const displayPnL = shouldDisplay ? canonicalPnL.uiPnL : 0;

  const result: WalletPnlDisplay = {
    wallet: canonicalPnL.wallet,
    canonicalEngine: 'V29_UIPARITY',
    cohort: cohortDecision.cohort,
    cohortReason: cohortDecision.reason,
    displayPnL,
    displayLabel,
    confidence,
    shouldDisplay,
  };

  // Step 6: Add debug info if requested
  if (includeDebug) {
    result.debug = {
      uiPnL: canonicalPnL.uiPnL,
      realizedPnL: canonicalPnL.realizedPnL,
      unrealizedPnL: canonicalPnL.unrealizedPnL,
      resolvedUnredeemedValue: canonicalPnL.resolvedUnredeemedValue,
      eventsProcessed: canonicalPnL.eventsProcessed,
      dataHealth: canonicalPnL.dataHealth,
      tags,
    };
  }

  return result;
}

// ============================================================================
// Batch Router (for leaderboards, etc.)
// ============================================================================

/**
 * Get PnL display for multiple wallets.
 *
 * Use this for leaderboards or batch operations.
 * Processes wallets in parallel for efficiency.
 *
 * @param wallets - Array of wallet addresses
 * @param options - Router options
 * @returns Map of wallet -> WalletPnlDisplay
 */
export async function getWalletsPnlDisplay(
  wallets: string[],
  options: RouterOptions = {}
): Promise<Map<string, WalletPnlDisplay>> {
  const results = new Map<string, WalletPnlDisplay>();

  // Process in batches of 5 for reasonable parallelism
  const batchSize = 5;
  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(wallet => getWalletPnlDisplay(wallet, options).catch(err => ({
        wallet,
        canonicalEngine: 'V29_UIPARITY' as const,
        cohort: 'SUSPECT' as WalletCohort,
        cohortReason: `ERROR: ${err.message}`,
        displayPnL: 0,
        displayLabel: 'PnL hidden - error',
        confidence: 0,
        shouldDisplay: false,
      })))
    );

    for (const result of batchResults) {
      results.set(result.wallet.toLowerCase(), result);
    }
  }

  return results;
}

// ============================================================================
// Quick Lookup (for caching/precomputed results)
// ============================================================================

/**
 * Compute display result from precomputed values.
 *
 * Use this when you already have V29 PnL and tags from a cache or
 * precomputed source (e.g., regression JSON).
 */
export function computeDisplayFromCache(
  wallet: string,
  canonicalPnL: V29CanonicalPnL,
  tags: WalletTags,
  uiParityErrorPct: number,
  timedOut: boolean = false
): WalletPnlDisplay {
  const cohortDecision = classifyCohort({
    pnl: canonicalPnL,
    tags,
    uiParityErrorPct,
    timedOut,
  });

  const displayLabel = getCohortDisplayLabel(cohortDecision.cohort);
  const shouldDisplay = shouldDisplayPnL(cohortDecision.cohort);
  const confidence = getCohortConfidence(cohortDecision.cohort);
  const displayPnL = shouldDisplay ? canonicalPnL.uiPnL : 0;

  return {
    wallet,
    canonicalEngine: 'V29_UIPARITY',
    cohort: cohortDecision.cohort,
    cohortReason: cohortDecision.reason,
    displayPnL,
    displayLabel,
    confidence,
    shouldDisplay,
    debug: {
      uiPnL: canonicalPnL.uiPnL,
      realizedPnL: canonicalPnL.realizedPnL,
      unrealizedPnL: canonicalPnL.unrealizedPnL,
      resolvedUnredeemedValue: canonicalPnL.resolvedUnredeemedValue,
      eventsProcessed: canonicalPnL.eventsProcessed,
      dataHealth: canonicalPnL.dataHealth,
      tags,
    },
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { WalletCohort, CohortDecision, WalletTags } from './cohortClassifier';
export {
  getCohortDisplayLabel,
  shouldDisplayPnL,
  getCohortConfidence,
} from './cohortClassifier';

export type { V29CanonicalPnL } from './inventoryEngineV29';
export { getV29CanonicalPnL } from './inventoryEngineV29';
