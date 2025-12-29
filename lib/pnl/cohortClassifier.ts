/**
 * ============================================================================
 * COHORT CLASSIFIER - Production Wallet Classification
 * ============================================================================
 *
 * Encodes the cohort rules from HEAD_TO_HEAD_V23C_V29_2025_12_06.md into
 * a reusable module that BOTH the regression harness and production API/UI
 * can call.
 *
 * COHORTS:
 * - SAFE: TRADER_STRICT, <3% error, no data issues
 * - MODERATE: MIXED, <5% error
 * - RISKY: MAKER_HEAVY, any error level
 * - SUSPECT: Timeouts, inventory mismatches, missing resolutions
 *
 * Terminal: Claude 1 (Main Terminal)
 * Date: 2025-12-06
 */

import { V29CanonicalPnL } from './inventoryEngineV29';

// ============================================================================
// Types
// ============================================================================

/**
 * Production cohort classification.
 *
 * These map directly to UI behavior:
 * - SAFE: Show PnL confidently
 * - MODERATE: Show with "estimate" label
 * - RISKY: Show with disclaimer
 * - SUSPECT: Hide PnL entirely
 */
export type WalletCohort = 'SAFE' | 'MODERATE' | 'RISKY' | 'SUSPECT';

/**
 * Cohort decision with human-readable reason.
 */
export interface CohortDecision {
  cohort: WalletCohort;
  reason: string;
}

/**
 * Wallet tags from the regression harness.
 * These describe the wallet's trading behavior.
 */
export interface WalletTags {
  isTraderStrict: boolean;    // CLOB-only, no splits/merges
  isMixed: boolean;           // Some CTF activity but still tradeable
  isMakerHeavy: boolean;      // Market maker with heavy CTF activity
  isDataSuspect: boolean;     // Data quality issues detected
  splitCount: number;         // Number of position split events
  mergeCount: number;         // Number of position merge events
  clobCount: number;          // Number of CLOB trades
  inventoryMismatch: number;  // Tokens sold without tracked buys
  missingResolutions: number; // Resolved conditions missing from table
}

/**
 * Classification inputs combining PnL data and tags.
 */
export interface ClassificationInput {
  /** V29 canonical PnL result */
  pnl: V29CanonicalPnL;

  /** Wallet behavior tags */
  tags: WalletTags;

  /** V29 UiParity error percentage (vs UI benchmark) */
  uiParityErrorPct: number;

  /** Whether the wallet timed out during processing */
  timedOut?: boolean;
}

// ============================================================================
// Thresholds (from HEAD_TO_HEAD spec)
// ============================================================================

const THRESHOLDS = {
  /** Max error % for SAFE cohort */
  SAFE_ERROR_PCT: 3,

  /** Max error % for MODERATE cohort */
  MODERATE_ERROR_PCT: 5,

  /** Error % threshold that triggers SUSPECT */
  SUSPECT_ERROR_PCT: 10,

  /** Min inventory mismatch to trigger SUSPECT */
  SUSPECT_INVENTORY_MISMATCH: 0,

  /** Min missing resolutions to trigger SUSPECT */
  SUSPECT_MISSING_RESOLUTIONS: 0,

  /** Min negative inventory positions to trigger SUSPECT */
  SUSPECT_NEGATIVE_INVENTORY: 0,
} as const;

// ============================================================================
// Classification Logic
// ============================================================================

/**
 * Classify a wallet into a production cohort.
 *
 * Order of precedence (highest to lowest):
 * 1. SUSPECT - Data quality issues or timeouts
 * 2. SAFE - TRADER_STRICT with excellent accuracy
 * 3. MODERATE - MIXED with good accuracy
 * 4. RISKY - MAKER_HEAVY or doesn't fit other categories
 *
 * @param input - Classification inputs (PnL, tags, error %)
 * @returns CohortDecision with cohort and reason
 */
export function classifyCohort(input: ClassificationInput): CohortDecision {
  const { pnl, tags, uiParityErrorPct, timedOut } = input;
  const absError = Math.abs(uiParityErrorPct);
  const dh = pnl.dataHealth;

  // ========================================================================
  // SUSPECT CHECKS (highest priority - data quality issues)
  // ========================================================================

  // Timeout always triggers SUSPECT
  if (timedOut) {
    return {
      cohort: 'SUSPECT',
      reason: 'SUSPECT: Wallet timed out during processing',
    };
  }

  // Inventory mismatch (significant tokens we couldn't account for)
  if (dh.inventoryMismatch > THRESHOLDS.SUSPECT_INVENTORY_MISMATCH) {
    return {
      cohort: 'SUSPECT',
      reason: `SUSPECT: Inventory mismatch detected (${dh.inventoryMismatch.toFixed(0)} tokens)`,
    };
  }

  // Missing resolutions
  if (tags.missingResolutions > THRESHOLDS.SUSPECT_MISSING_RESOLUTIONS) {
    return {
      cohort: 'SUSPECT',
      reason: `SUSPECT: Missing resolutions (${tags.missingResolutions} conditions)`,
    };
  }

  // Negative inventory positions
  if (dh.negativeInventoryPositions > THRESHOLDS.SUSPECT_NEGATIVE_INVENTORY) {
    return {
      cohort: 'SUSPECT',
      reason: `SUSPECT: Negative inventory positions (${dh.negativeInventoryPositions} positions)`,
    };
  }

  // Extreme error (>10% even for non-makers)
  if (absError >= THRESHOLDS.SUSPECT_ERROR_PCT && !tags.isMakerHeavy) {
    return {
      cohort: 'SUSPECT',
      reason: `SUSPECT: High error rate (${absError.toFixed(1)}%)`,
    };
  }

  // isDataSuspect tag
  if (tags.isDataSuspect) {
    return {
      cohort: 'SUSPECT',
      reason: 'SUSPECT: Data quality issues detected by tagger',
    };
  }

  // ========================================================================
  // RISKY CHECK (market makers)
  // ========================================================================

  if (tags.isMakerHeavy) {
    return {
      cohort: 'RISKY',
      reason: `RISKY: MAKER_HEAVY wallet with dense CTF activity (${tags.splitCount} splits, ${tags.mergeCount} merges)`,
    };
  }

  // ========================================================================
  // SAFE CHECK (TRADER_STRICT with excellent accuracy)
  // ========================================================================

  if (tags.isTraderStrict) {
    // Must meet ALL criteria for SAFE:
    // - isTraderStrict
    // - |error| < 3%
    // - No splits/merges
    // - No inventory issues
    const meetsAllCriteria =
      absError < THRESHOLDS.SAFE_ERROR_PCT &&
      tags.splitCount === 0 &&
      tags.mergeCount === 0 &&
      dh.inventoryMismatch === 0 &&
      tags.missingResolutions === 0;

    if (meetsAllCriteria) {
      return {
        cohort: 'SAFE',
        reason: `SAFE: TRADER_STRICT, no splits/merges, no data issues, <${THRESHOLDS.SAFE_ERROR_PCT}% error (${absError.toFixed(1)}%)`,
      };
    }

    // TRADER_STRICT but doesn't meet SAFE criteria - fall through to MODERATE
  }

  // ========================================================================
  // MODERATE CHECK (MIXED or TRADER_STRICT that didn't qualify for SAFE)
  // ========================================================================

  if (tags.isMixed || tags.isTraderStrict) {
    if (absError < THRESHOLDS.MODERATE_ERROR_PCT) {
      return {
        cohort: 'MODERATE',
        reason: `MODERATE: ${tags.isMixed ? 'MIXED' : 'TRADER_STRICT'} wallet with <${THRESHOLDS.MODERATE_ERROR_PCT}% error (${absError.toFixed(1)}%)`,
      };
    }
  }

  // ========================================================================
  // FALLBACK
  // ========================================================================

  // If nothing else matches, default to MODERATE with explanation
  return {
    cohort: 'MODERATE',
    reason: `MODERATE: Fallback classification (error: ${absError.toFixed(1)}%, tags: ${formatTags(tags)})`,
  };
}

/**
 * Format tags into a readable string.
 */
function formatTags(tags: WalletTags): string {
  const parts: string[] = [];
  if (tags.isTraderStrict) parts.push('TRADER_STRICT');
  if (tags.isMixed) parts.push('MIXED');
  if (tags.isMakerHeavy) parts.push('MAKER_HEAVY');
  if (tags.isDataSuspect) parts.push('DATA_SUSPECT');
  return parts.join(', ') || 'UNTAGGED';
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick cohort check without full classification input.
 *
 * Use this when you only have basic info (tags + error %).
 */
export function quickClassify(
  tags: WalletTags,
  uiParityErrorPct: number,
  timedOut: boolean = false
): CohortDecision {
  // Create a minimal PnL object for classification
  const minimalPnL: V29CanonicalPnL = {
    wallet: '',
    uiPnL: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    resolvedUnredeemedValue: 0,
    dataHealth: {
      inventoryMismatch: tags.inventoryMismatch,
      missingResolutions: tags.missingResolutions,
      negativeInventoryPositions: 0,
      negativeInventoryPnlAdjustment: 0,
      clampedPositions: 0,
    },
    eventsProcessed: 0,
    errors: [],
  };

  return classifyCohort({
    pnl: minimalPnL,
    tags,
    uiParityErrorPct,
    timedOut,
  });
}

/**
 * Get cohort-based display label for UI.
 */
export function getCohortDisplayLabel(cohort: WalletCohort): string {
  switch (cohort) {
    case 'SAFE':
      return 'PnL (precise)';
    case 'MODERATE':
      return 'PnL (estimate)';
    case 'RISKY':
      return 'PnL (maker mode - volatile)';
    case 'SUSPECT':
      return 'PnL hidden - data suspect';
  }
}

/**
 * Check if PnL should be displayed for this cohort.
 */
export function shouldDisplayPnL(cohort: WalletCohort): boolean {
  return cohort !== 'SUSPECT';
}

/**
 * Get confidence level for cohort (0-1).
 */
export function getCohortConfidence(cohort: WalletCohort): number {
  switch (cohort) {
    case 'SAFE':
      return 0.95;
    case 'MODERATE':
      return 0.75;
    case 'RISKY':
      return 0.4;
    case 'SUSPECT':
      return 0;
  }
}
