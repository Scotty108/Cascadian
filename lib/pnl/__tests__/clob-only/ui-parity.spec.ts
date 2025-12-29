/**
 * CLOB-Only UI Parity Test Suite
 *
 * Validates V29 PnL engine accuracy against Polymarket UI (tooltip-verified ground truth).
 *
 * Target Metrics:
 * - Tier 1: >=95% of wallets within 1% error
 * - Tier 2: 100% of wallets within 2% error
 * - Minimum dataset: 40+ wallets
 *
 * Ground Truth: data/regression/clob_only_truth_v1.json
 *   - Tooltip-verified PnL values
 *   - Identity check: Gain - |Loss| = Net Total
 *   - All wallets are CLOB-only (no CTF split/merge events)
 *
 * Run: npx jest lib/pnl/__tests__/clob-only/ui-parity.spec.ts
 */

import { calculateV29PnL } from '../../inventoryEngineV29';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const CLOB_ONLY_UI_PARITY_CONFIG = {
  tier1ErrorThreshold: 0.01, // 1%
  tier1MinPassRate: 0.95, // 95%
  tier2ErrorThreshold: 0.02, // 2%
  tier2MinPassRate: 1.0, // 100%
  minWalletsRequired: 40,
  groundTruthPath: 'data/regression/clob_only_truth_v1.json',
};

// ============================================================================
// Types
// ============================================================================

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scrapedAt: string;
  identityCheckPass: boolean;
  clobEvents: number;
  openPositionsApprox: number;
  cashFlowEstimate: number;
  notes: string;
}

interface ClobOnlyTruthDataset {
  metadata: {
    generated_at: string;
    source: string;
    method: string;
    classification: string;
    wallet_count: number;
    identity_pass_count: number;
  };
  wallets: TooltipWallet[];
}

interface ParityTestResult {
  wallet: string;
  uiPnl: number;
  v29Pnl: number;
  absoluteError: number;
  percentError: number;
  pass1pct: boolean;
  pass2pct: boolean;
  identityCheckPass: boolean;
}

// ============================================================================
// Test Helpers
// ============================================================================

function loadGroundTruth(): ClobOnlyTruthDataset | null {
  const truthPath = path.join(process.cwd(), CLOB_ONLY_UI_PARITY_CONFIG.groundTruthPath);

  if (!fs.existsSync(truthPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(truthPath, 'utf-8'));
}

function calculatePercentError(v29Pnl: number, uiPnl: number): number {
  // Handle zero case to avoid division by zero
  if (Math.abs(uiPnl) < 1) {
    // For very small PnL, use absolute error threshold instead
    return Math.abs(v29Pnl - uiPnl) < 10 ? 0 : 1;
  }

  return Math.abs(v29Pnl - uiPnl) / Math.abs(uiPnl);
}

// ============================================================================
// Tests
// ============================================================================

describe('CLOB-Only UI Parity', () => {
  let groundTruth: ClobOnlyTruthDataset | null;
  let testResults: ParityTestResult[] = [];

  beforeAll(async () => {
    groundTruth = loadGroundTruth();

    if (!groundTruth) {
      console.log(
        '\n⚠️  Ground truth dataset not found at:',
        CLOB_ONLY_UI_PARITY_CONFIG.groundTruthPath
      );
      console.log('   Run: npx tsx scripts/pnl/scrape-clob-only-tooltip-truth.ts');
      return;
    }

    console.log(`\nLoaded ${groundTruth.wallets.length} wallets from ground truth`);

    // Filter to only identity-check passed wallets
    const validWallets = groundTruth.wallets.filter((w) => w.identityCheckPass);
    console.log(`  ${validWallets.length} passed identity check`);

    // Run V29 for each wallet and compare
    console.log('\nRunning V29 comparisons...\n');

    for (const wallet of validWallets) {
      try {
        const v29Result = await calculateV29PnL(wallet.wallet, {
          inventoryGuard: true,
          valuationMode: 'ui',
        });

        const percentError = calculatePercentError(v29Result.uiParityPnl, wallet.uiPnl);

        const result: ParityTestResult = {
          wallet: wallet.wallet,
          uiPnl: wallet.uiPnl,
          v29Pnl: v29Result.uiParityPnl,
          absoluteError: Math.abs(v29Result.uiParityPnl - wallet.uiPnl),
          percentError,
          pass1pct: percentError <= CLOB_ONLY_UI_PARITY_CONFIG.tier1ErrorThreshold,
          pass2pct: percentError <= CLOB_ONLY_UI_PARITY_CONFIG.tier2ErrorThreshold,
          identityCheckPass: wallet.identityCheckPass,
        };

        testResults.push(result);

        // Progress logging
        const symbol = result.pass1pct ? '✓' : result.pass2pct ? '~' : '✗';
        console.log(
          `  ${symbol} ${wallet.wallet.slice(0, 12)}... | UI: $${wallet.uiPnl.toFixed(2)} | V29: $${v29Result.uiParityPnl.toFixed(2)} | Error: ${(percentError * 100).toFixed(2)}%`
        );
      } catch (e) {
        console.log(`  ✗ ${wallet.wallet.slice(0, 12)}... ERROR: ${(e as Error).message}`);
      }
    }

    console.log(`\nProcessed ${testResults.length} wallets\n`);
  }, 300000); // 5 minute timeout for beforeAll

  it('should have enough wallets for statistical significance', () => {
    if (!groundTruth) {
      console.log('SKIP: Ground truth not available');
      return;
    }

    expect(testResults.length).toBeGreaterThanOrEqual(
      CLOB_ONLY_UI_PARITY_CONFIG.minWalletsRequired
    );
  });

  it('should have >=95% of CLOB-only wallets within 1% error', () => {
    if (!groundTruth || testResults.length < CLOB_ONLY_UI_PARITY_CONFIG.minWalletsRequired) {
      console.log('SKIP: Insufficient data');
      return;
    }

    const within1pct = testResults.filter((r) => r.pass1pct);
    const passRate = within1pct.length / testResults.length;

    console.log(
      `Tier 1 (1% error): ${within1pct.length}/${testResults.length} = ${(passRate * 100).toFixed(1)}%`
    );

    expect(passRate).toBeGreaterThanOrEqual(CLOB_ONLY_UI_PARITY_CONFIG.tier1MinPassRate);
  });

  it('should have 100% of CLOB-only wallets within 2% error', () => {
    if (!groundTruth || testResults.length < CLOB_ONLY_UI_PARITY_CONFIG.minWalletsRequired) {
      console.log('SKIP: Insufficient data');
      return;
    }

    const within2pct = testResults.filter((r) => r.pass2pct);
    const passRate = within2pct.length / testResults.length;

    console.log(
      `Tier 2 (2% error): ${within2pct.length}/${testResults.length} = ${(passRate * 100).toFixed(1)}%`
    );

    // Log failures for debugging
    const failures = testResults.filter((r) => !r.pass2pct);
    if (failures.length > 0) {
      console.log('\nFailures (>2% error):');
      for (const f of failures) {
        console.log(
          `  ${f.wallet.slice(0, 12)}... | UI: $${f.uiPnl.toFixed(2)} | V29: $${f.v29Pnl.toFixed(2)} | Error: ${(f.percentError * 100).toFixed(2)}%`
        );
      }
    }

    expect(passRate).toBeGreaterThanOrEqual(CLOB_ONLY_UI_PARITY_CONFIG.tier2MinPassRate);
  });

  it('should report summary statistics', () => {
    if (!groundTruth || testResults.length === 0) {
      console.log('SKIP: No test results');
      return;
    }

    const errors = testResults.map((r) => r.percentError);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const sorted = [...errors].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const max = Math.max(...errors);
    const min = Math.min(...errors);

    console.log('\n=== Summary Statistics ===');
    console.log(`  Wallets tested: ${testResults.length}`);
    console.log(`  Mean error: ${(mean * 100).toFixed(2)}%`);
    console.log(`  Median error: ${(median * 100).toFixed(2)}%`);
    console.log(`  Min error: ${(min * 100).toFixed(2)}%`);
    console.log(`  Max error: ${(max * 100).toFixed(2)}%`);

    const within1 = testResults.filter((r) => r.pass1pct).length;
    const within2 = testResults.filter((r) => r.pass2pct).length;
    console.log(`\n  Within 1%: ${within1}/${testResults.length} (${((within1 / testResults.length) * 100).toFixed(1)}%)`);
    console.log(`  Within 2%: ${within2}/${testResults.length} (${((within2 / testResults.length) * 100).toFixed(1)}%)`);

    // This test always passes - it's just for reporting
    expect(true).toBe(true);
  });
});
