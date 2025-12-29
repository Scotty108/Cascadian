/**
 * Multi-Engine Agreement Confidence Model
 *
 * ============================================================================
 * Confidence scoring based on engine agreement
 * ============================================================================
 *
 * When multiple PnL engines agree on a wallet's realized PnL, we have higher
 * confidence in the result. When they disagree, we flag for manual review.
 *
 * Confidence levels:
 * - HIGH: All engines within 6% of each other
 * - MEDIUM: At least 2 engines within 6% of each other
 * - LOW: Engines disagree significantly
 * - FLAGGED: Potential overcorrection detected (synthetic pairs > threshold)
 */

import { createV11Engine, WalletMetricsV11 } from './uiActivityEngineV11';
import { createV11bEngine, WalletMetricsV11b } from './uiActivityEngineV11b';
import { createV11cEngine, WalletMetricsV11c } from './uiActivityEngineV11c';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'FLAGGED';

export interface EngineResults {
  v11: number;
  v11b: number;
  v11c: number;
}

export interface ConfidenceResult {
  wallet: string;

  // Engine outputs
  engines: EngineResults;

  // Best estimate (consensus or median)
  bestEstimate: number;
  selectedEngine: 'v11' | 'v11b' | 'v11c';

  // Confidence scoring
  confidence: ConfidenceLevel;
  confidenceReason: string;

  // Agreement metrics
  maxSpread: number; // Max % difference between engines
  pairwiseAgreement: {
    v11_v11b: boolean;
    v11_v11c: boolean;
    v11b_v11c: boolean;
  };

  // Risk flags
  syntheticPairsCount: number;
  overcorrectionRisk: boolean;
}

export interface ConfidenceConfig {
  // Agreement threshold (default 6%)
  agreementThreshold: number;

  // Synthetic pairs threshold for flagging
  syntheticPairsWarningThreshold: number;
  syntheticPairsDangerThreshold: number;
}

const DEFAULT_CONFIG: ConfidenceConfig = {
  agreementThreshold: 0.06, // 6%
  syntheticPairsWarningThreshold: 100,
  syntheticPairsDangerThreshold: 500,
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Check if two values agree within threshold
 */
function agreesWithin(a: number, b: number, threshold: number): boolean {
  if (a === 0 && b === 0) return true;
  if (a === 0 || b === 0) return Math.abs(a - b) < 10; // $10 for near-zero

  const pctDiff = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  return pctDiff <= threshold;
}

/**
 * Calculate percentage spread between min and max
 */
function calculateSpread(values: number[]): number {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === 0 && min === 0) return 0;
  if (max === 0 || min === 0) return 1; // 100% spread if one is zero

  return (max - min) / Math.max(Math.abs(max), Math.abs(min));
}

/**
 * Get median of values
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// -----------------------------------------------------------------------------
// Main Confidence Engine
// -----------------------------------------------------------------------------

export class ConfidenceEngine {
  private v11 = createV11Engine();
  private v11b = createV11bEngine();
  private v11c = createV11cEngine();
  private config: ConfidenceConfig;

  constructor(config?: Partial<ConfidenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute all engines and assess confidence
   */
  async assess(wallet: string): Promise<ConfidenceResult> {
    // Run all engines
    const [r11, r11b, r11c] = await Promise.all([
      this.v11.compute(wallet),
      this.v11b.compute(wallet),
      this.v11c.compute(wallet),
    ]);

    const engines: EngineResults = {
      v11: r11.realized_pnl,
      v11b: r11b.realized_pnl,
      v11c: r11c.realized_pnl,
    };

    // Get synthetic pairs count from V11b/V11c
    const syntheticPairsCount = r11b.syntheticPairsDetected;

    // Check pairwise agreement
    const threshold = this.config.agreementThreshold;
    const pairwiseAgreement = {
      v11_v11b: agreesWithin(engines.v11, engines.v11b, threshold),
      v11_v11c: agreesWithin(engines.v11, engines.v11c, threshold),
      v11b_v11c: agreesWithin(engines.v11b, engines.v11c, threshold),
    };

    // Calculate spread
    const maxSpread = calculateSpread([engines.v11, engines.v11b, engines.v11c]);

    // Determine confidence level and best estimate
    let confidence: ConfidenceLevel;
    let confidenceReason: string;
    let bestEstimate: number;
    let selectedEngine: 'v11' | 'v11b' | 'v11c';

    // Check for overcorrection risk
    const overcorrectionRisk =
      syntheticPairsCount > this.config.syntheticPairsDangerThreshold;

    if (overcorrectionRisk) {
      // Flag wallets with many synthetic pairs
      confidence = 'FLAGGED';
      confidenceReason = `High synthetic pair count (${syntheticPairsCount}) - overcorrection risk`;
      // Use V11 (conservative) when flagged
      bestEstimate = engines.v11;
      selectedEngine = 'v11';
    } else if (
      pairwiseAgreement.v11_v11b &&
      pairwiseAgreement.v11_v11c &&
      pairwiseAgreement.v11b_v11c
    ) {
      // All three agree
      confidence = 'HIGH';
      confidenceReason = 'All engines agree within threshold';
      bestEstimate = median([engines.v11, engines.v11b, engines.v11c]);
      // Select the engine closest to median
      const diffs = {
        v11: Math.abs(engines.v11 - bestEstimate),
        v11b: Math.abs(engines.v11b - bestEstimate),
        v11c: Math.abs(engines.v11c - bestEstimate),
      };
      selectedEngine = (Object.entries(diffs).sort((a, b) => a[1] - b[1])[0][0] as 'v11' | 'v11b' | 'v11c');
    } else if (
      pairwiseAgreement.v11_v11b ||
      pairwiseAgreement.v11_v11c ||
      pairwiseAgreement.v11b_v11c
    ) {
      // At least two agree
      confidence = 'MEDIUM';

      if (pairwiseAgreement.v11_v11b) {
        confidenceReason = 'V11 and V11b agree';
        bestEstimate = (engines.v11 + engines.v11b) / 2;
        selectedEngine = 'v11b'; // V11b has better overall pass rate
      } else if (pairwiseAgreement.v11_v11c) {
        confidenceReason = 'V11 and V11c agree';
        bestEstimate = (engines.v11 + engines.v11c) / 2;
        selectedEngine = 'v11';
      } else {
        confidenceReason = 'V11b and V11c agree';
        bestEstimate = (engines.v11b + engines.v11c) / 2;
        selectedEngine = 'v11b';
      }
    } else {
      // No agreement
      confidence = 'LOW';
      confidenceReason = `Engines disagree (spread: ${(maxSpread * 100).toFixed(1)}%)`;
      // Default to V11 (most conservative)
      bestEstimate = engines.v11;
      selectedEngine = 'v11';
    }

    return {
      wallet,
      engines,
      bestEstimate,
      selectedEngine,
      confidence,
      confidenceReason,
      maxSpread,
      pairwiseAgreement,
      syntheticPairsCount,
      overcorrectionRisk,
    };
  }

  /**
   * Batch assessment with progress callback
   */
  async assessBatch(
    wallets: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<ConfidenceResult[]> {
    const results: ConfidenceResult[] = [];

    for (let i = 0; i < wallets.length; i++) {
      try {
        const result = await this.assess(wallets[i]);
        results.push(result);
      } catch (err) {
        console.error(`Error assessing ${wallets[i]}:`, err);
      }

      if (onProgress) {
        onProgress(i + 1, wallets.length);
      }
    }

    return results;
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createConfidenceEngine(
  config?: Partial<ConfidenceConfig>
): ConfidenceEngine {
  return new ConfidenceEngine(config);
}

// -----------------------------------------------------------------------------
// Summary Statistics
// -----------------------------------------------------------------------------

export interface ConfidenceSummary {
  total: number;
  byConfidence: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    FLAGGED: number;
  };
  avgSpread: number;
  overcorrectionCount: number;
}

export function summarizeConfidence(results: ConfidenceResult[]): ConfidenceSummary {
  const summary: ConfidenceSummary = {
    total: results.length,
    byConfidence: { HIGH: 0, MEDIUM: 0, LOW: 0, FLAGGED: 0 },
    avgSpread: 0,
    overcorrectionCount: 0,
  };

  let totalSpread = 0;

  for (const r of results) {
    summary.byConfidence[r.confidence]++;
    totalSpread += r.maxSpread;
    if (r.overcorrectionRisk) summary.overcorrectionCount++;
  }

  summary.avgSpread = totalSpread / results.length;

  return summary;
}
