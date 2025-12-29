/**
 * ============================================================================
 * VALIDATION THRESHOLDS - Unified Pass/Fail Logic
 * ============================================================================
 *
 * Single source of truth for all PnL validation thresholds.
 * Used by: validate-v11-vs-dome, validate-v29-vs-dome, validate-ui-parity, run-unified-scorecard
 *
 * See: docs/reports/PNL_TAXONOMY.md for full definitions.
 *
 * Terminal: Claude 1 (Main Terminal)
 * Date: 2025-12-07
 */

// ============================================================================
// Threshold Configuration
// ============================================================================

export interface ThresholdConfig {
  /** For large PnL (|benchmark| >= largePnlThreshold): max percentage error */
  pctThreshold: number;
  /** For small PnL (|benchmark| < largePnlThreshold): max absolute error in USD */
  absThreshold: number;
  /** PnL magnitude that determines which threshold to use */
  largePnlThreshold: number;
  /** Whether sign disagreement is an automatic fail */
  signMustMatch: boolean;
}

/**
 * Default thresholds for Dome benchmark (realized-to-realized comparison).
 */
export const DOME_THRESHOLDS: ThresholdConfig = {
  pctThreshold: 6,           // 6% for large wallets
  absThreshold: 10,          // $10 for small wallets
  largePnlThreshold: 200,    // |Dome| >= $200 uses percentage
  signMustMatch: true,       // Sign disagreement = fail
};

/**
 * Default thresholds for UI benchmark (total-to-total comparison).
 * Slightly tighter than Dome since UI is our target.
 */
export const UI_THRESHOLDS: ThresholdConfig = {
  pctThreshold: 5,           // 5% for large wallets
  absThreshold: 10,          // $10 for small wallets
  largePnlThreshold: 200,    // |UI| >= $200 uses percentage
  signMustMatch: true,       // Sign disagreement = fail
};

/**
 * Loose thresholds for exploratory analysis.
 */
export const LOOSE_THRESHOLDS: ThresholdConfig = {
  pctThreshold: 10,          // 10% for large wallets
  absThreshold: 25,          // $25 for small wallets
  largePnlThreshold: 100,    // Lower threshold
  signMustMatch: false,      // Allow sign differences
};

// ============================================================================
// Pass/Fail Functions
// ============================================================================

export interface PassResult {
  /** Whether the validation passed */
  passed: boolean;
  /** Which threshold was applied */
  thresholdUsed: 'pct' | 'abs' | 'both_zero';
  /** The actual error value (percentage or absolute depending on thresholdUsed) */
  error: number;
  /** Percentage error (always calculated for reporting) */
  pctError: number;
  /** Absolute error in USD */
  absError: number;
  /** Human-readable failure reason (if failed) */
  failureReason?: string;
}

/**
 * Check if a PnL comparison passes validation.
 *
 * @param benchmarkValue - The reference value (Dome or UI PnL)
 * @param ourValue - Our calculated value
 * @param config - Threshold configuration to use
 * @returns PassResult with pass/fail status and error details
 */
export function isPass(
  benchmarkValue: number,
  ourValue: number,
  config: ThresholdConfig = DOME_THRESHOLDS
): PassResult {
  const absError = Math.abs(ourValue - benchmarkValue);
  const absBenchmark = Math.abs(benchmarkValue);
  const absOurs = Math.abs(ourValue);

  // Calculate percentage error (avoid div by zero)
  const pctError = absBenchmark > 0
    ? (absError / absBenchmark) * 100
    : (absError > 0 ? 100 : 0);

  // Special case: both near zero
  if (absBenchmark < 1 && absOurs < 1) {
    return {
      passed: true,
      thresholdUsed: 'both_zero',
      error: absError,
      pctError,
      absError,
    };
  }

  // Check sign disagreement
  if (config.signMustMatch) {
    const benchmarkPositive = benchmarkValue >= 0;
    const oursPositive = ourValue >= 0;
    if (benchmarkPositive !== oursPositive && absBenchmark >= 10 && absOurs >= 10) {
      return {
        passed: false,
        thresholdUsed: absBenchmark >= config.largePnlThreshold ? 'pct' : 'abs',
        error: pctError,
        pctError,
        absError,
        failureReason: 'SIGN_DISAGREEMENT',
      };
    }
  }

  // Choose threshold based on benchmark magnitude
  if (absBenchmark >= config.largePnlThreshold) {
    // Large PnL: use percentage threshold
    const passed = pctError <= config.pctThreshold;
    return {
      passed,
      thresholdUsed: 'pct',
      error: pctError,
      pctError,
      absError,
      failureReason: passed ? undefined : `PCT_ERROR_${pctError.toFixed(1)}`,
    };
  } else {
    // Small PnL: use absolute threshold
    const passed = absError <= config.absThreshold;
    return {
      passed,
      thresholdUsed: 'abs',
      error: absError,
      pctError,
      absError,
      failureReason: passed ? undefined : `ABS_ERROR_$${absError.toFixed(2)}`,
    };
  }
}

/**
 * Convenience function for Dome validation.
 */
export function isPassDome(domeRealized: number, ourRealized: number): PassResult {
  return isPass(domeRealized, ourRealized, DOME_THRESHOLDS);
}

/**
 * Convenience function for UI validation.
 */
export function isPassUI(uiPnl: number, ourPnl: number): PassResult {
  return isPass(uiPnl, ourPnl, UI_THRESHOLDS);
}

// ============================================================================
// Batch Statistics
// ============================================================================

export interface BatchStats {
  total: number;
  passed: number;
  failed: number;
  passRate: number;

  // By threshold type
  largePnlCount: number;
  largePnlPassed: number;
  largePnlPassRate: number;

  smallPnlCount: number;
  smallPnlPassed: number;
  smallPnlPassRate: number;

  // Error statistics
  medianPctError: number;
  medianAbsError: number;
  p90PctError: number;
  p90AbsError: number;

  // Failure breakdown
  failureReasons: Record<string, number>;
}

/**
 * Calculate statistics for a batch of validation results.
 */
export function calculateBatchStats(
  results: Array<{ benchmarkValue: number; ourValue: number; passed: boolean; failureReason?: string }>,
  config: ThresholdConfig = DOME_THRESHOLDS
): BatchStats {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;

  const large = results.filter(r => Math.abs(r.benchmarkValue) >= config.largePnlThreshold);
  const small = results.filter(r => Math.abs(r.benchmarkValue) < config.largePnlThreshold);

  const pctErrors: number[] = [];
  const absErrors: number[] = [];
  const failureReasons: Record<string, number> = {};

  for (const r of results) {
    const absError = Math.abs(r.ourValue - r.benchmarkValue);
    const absBenchmark = Math.abs(r.benchmarkValue);
    const pctError = absBenchmark > 0 ? (absError / absBenchmark) * 100 : (absError > 0 ? 100 : 0);

    pctErrors.push(pctError);
    absErrors.push(absError);

    if (!r.passed && r.failureReason) {
      failureReasons[r.failureReason] = (failureReasons[r.failureReason] || 0) + 1;
    }
  }

  return {
    total,
    passed,
    failed: total - passed,
    passRate: total > 0 ? passed / total : 0,

    largePnlCount: large.length,
    largePnlPassed: large.filter(r => r.passed).length,
    largePnlPassRate: large.length > 0 ? large.filter(r => r.passed).length / large.length : 0,

    smallPnlCount: small.length,
    smallPnlPassed: small.filter(r => r.passed).length,
    smallPnlPassRate: small.length > 0 ? small.filter(r => r.passed).length / small.length : 0,

    medianPctError: percentile(pctErrors, 50),
    medianAbsError: percentile(absErrors, 50),
    p90PctError: percentile(pctErrors, 90),
    p90AbsError: percentile(absErrors, 90),

    failureReasons,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Format a PassResult for console output.
 */
export function formatPassResult(r: PassResult): string {
  const status = r.passed ? 'PASS' : 'FAIL';
  const errorStr = r.thresholdUsed === 'pct'
    ? `${r.pctError.toFixed(1)}%`
    : `$${r.absError.toFixed(2)}`;
  const reason = r.failureReason ? ` (${r.failureReason})` : '';
  return `${status} [${r.thresholdUsed}] err=${errorStr}${reason}`;
}

/**
 * Get threshold description for display.
 */
export function describeThresholds(config: ThresholdConfig): string {
  return `Large (>=$${config.largePnlThreshold}): <=${config.pctThreshold}% | Small: <=$${config.absThreshold}`;
}
