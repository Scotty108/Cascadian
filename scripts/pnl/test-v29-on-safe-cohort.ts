/**
 * V29 Regression Test Harness on SAFE_TRADER_STRICT v2 Cohort
 *
 * This harness:
 * 1. Loads the SAFE_TRADER_STRICT v2 cohort from JSON
 * 2. Optionally re-runs V29 engine for each wallet (if available)
 * 3. Compares results to stored benchmarks and UI PnL
 * 4. Reports aggregate statistics and individual errors
 *
 * Usage:
 *   npx tsx scripts/pnl/test-v29-on-safe-cohort.ts          # Use stored values
 *   npx tsx scripts/pnl/test-v29-on-safe-cohort.ts --live   # Re-run V29 engine
 *   npx tsx scripts/pnl/test-v29-on-safe-cohort.ts --limit 5 # Test first 5 wallets
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface SafeTraderV2Entry {
  wallet: string;
  uiPnL: number;
  v29UiParityPnL: number;
  v29RealizedPnL: number;
  v29ResolvedUnredeemed: number;
  v29UiParityPctError: number;
  cashPnL: number | null;
  cashVsUiDeltaPct: number | null;
  tags: {
    isTraderStrict: boolean;
    splitCount: number;
    mergeCount: number;
    clobCount: number;
    inventoryMismatch: number;
    missingResolutions: number;
  };
  dataHealth: {
    hasCashData: boolean;
    cashVsV29Passes: boolean;
    uiVsV29Passes: boolean;
  };
}

interface SafeTraderV2Output {
  generatedAt: string;
  filterRule: string;
  summary: {
    totalSourceWallets: number;
    traderStrictCount: number;
    safeTraderStrictV2Count: number;
    medianUiError: number;
    meanUiError: number;
    p90UiError: number;
  };
  wallets: SafeTraderV2Entry[];
}

interface V29Result {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  resolvedUnredeemedValue: number;
  uiParityPnl: number;
  uiParityClampedPnl: number;
  totalPnl: number;
  positionsCount: number;
  openPositions: number;
  closedPositions: number;
  eventsProcessed: number;
  clampedPositions: number;
  negativeInventoryPositions: number;
  negativeInventoryPnlAdjustment: number;
  resolvedUnredeemedPositions: number;
  errors: string[];
}

interface TestResult {
  wallet: string;
  uiPnL: number;
  storedV29: number;
  newV29: number | null;
  errorVsUI: number;
  errorVsStored: number | null;
  status: 'pass' | 'fail' | 'error';
  errorMessage?: string;
}

interface AggregateStats {
  totalWallets: number;
  passCount: number;
  failCount: number;
  errorCount: number;
  meanAbsErrorVsUI: number;
  medianAbsErrorVsUI: number;
  p90AbsErrorVsUI: number;
  passRatePct: number;
}

// ============================================================================
// V29 Engine Import (with fallback)
// ============================================================================

let calculateV29PnL: ((wallet: string, options?: { inventoryGuard?: boolean }) => Promise<V29Result>) | null = null;

async function tryLoadV29Engine(): Promise<boolean> {
  try {
    const engine = await import('../../lib/pnl/inventoryEngineV29');
    calculateV29PnL = engine.calculateV29PnL;
    return true;
  } catch (e) {
    console.warn('⚠️  V29 engine not available. Using stored values only.\n');
    return false;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function computeStats(errors: number[]): { mean: number; median: number; p90: number } {
  if (errors.length === 0) return { mean: 0, median: 0, p90: 0 };

  const sorted = [...errors].sort((a, b) => a - b);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];

  return { mean, median, p90 };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return n.toFixed(4) + '%';
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests(options: { live: boolean; limit: number | null }): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('       V29 REGRESSION TEST HARNESS - SAFE_TRADER_STRICT v2');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Load cohort
  const cohortPath = path.join(process.cwd(), 'tmp/safe_trader_strict_v2_wallets.json');

  if (!fs.existsSync(cohortPath)) {
    console.error('❌ Cohort file not found. Run extract-safe-trader-strict-v2.ts first.');
    process.exit(1);
  }

  const cohort: SafeTraderV2Output = JSON.parse(fs.readFileSync(cohortPath, 'utf-8'));
  console.log(`📁 Loaded cohort: ${cohort.wallets.length} wallets`);
  console.log(`📅 Generated: ${cohort.generatedAt}`);
  console.log(`📋 Filter: ${cohort.filterRule}`);
  console.log('');

  // Check if we can run live
  let v29Available = false;
  if (options.live) {
    v29Available = await tryLoadV29Engine();
    if (!v29Available) {
      console.log('Falling back to stored values only.\n');
    }
  }

  // Select wallets
  let walletsToTest = cohort.wallets;
  if (options.limit !== null) {
    walletsToTest = walletsToTest.slice(0, options.limit);
    console.log(`🔢 Testing first ${options.limit} wallets\n`);
  }

  // Run tests
  const results: TestResult[] = [];
  const ERROR_THRESHOLD_PCT = 3.0;

  console.log('Running tests...\n');

  for (let i = 0; i < walletsToTest.length; i++) {
    const w = walletsToTest[i];
    const result: TestResult = {
      wallet: w.wallet,
      uiPnL: w.uiPnL,
      storedV29: w.v29UiParityPnL,
      newV29: null,
      errorVsUI: w.v29UiParityPctError,
      errorVsStored: null,
      status: 'pass',
    };

    // Run live V29 if available
    if (v29Available && calculateV29PnL) {
      try {
        const v29Result = await calculateV29PnL(w.wallet, { inventoryGuard: true });
        result.newV29 = v29Result.uiParityPnl;

        // Compute error vs stored
        if (w.v29UiParityPnL !== 0) {
          result.errorVsStored = ((v29Result.uiParityPnl - w.v29UiParityPnL) / Math.abs(w.v29UiParityPnL)) * 100;
        }

        // Compute new error vs UI
        if (w.uiPnL !== 0) {
          result.errorVsUI = ((v29Result.uiParityPnl - w.uiPnL) / Math.abs(w.uiPnL)) * 100;
        }
      } catch (e) {
        result.status = 'error';
        result.errorMessage = e instanceof Error ? e.message : String(e);
      }
    }

    // Determine pass/fail
    if (result.status !== 'error') {
      result.status = Math.abs(result.errorVsUI) < ERROR_THRESHOLD_PCT ? 'pass' : 'fail';
    }

    results.push(result);

    // Progress indicator
    process.stdout.write(`\r  Progress: ${i + 1}/${walletsToTest.length}`);
  }

  console.log('\n');

  // Compute aggregate stats
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  const absErrors = results
    .filter(r => r.status !== 'error')
    .map(r => Math.abs(r.errorVsUI));

  const stats = computeStats(absErrors);

  const aggregateStats: AggregateStats = {
    totalWallets: results.length,
    passCount,
    failCount,
    errorCount,
    meanAbsErrorVsUI: stats.mean,
    medianAbsErrorVsUI: stats.median,
    p90AbsErrorVsUI: stats.p90,
    passRatePct: (passCount / results.length) * 100,
  };

  // Print results table
  console.log('─'.repeat(100));
  console.log('WALLET                                      UI PnL         V29 UiParity    Error %   Status');
  console.log('─'.repeat(100));

  for (const r of results.slice(0, 15)) {
    const uiStr = formatNumber(r.uiPnL).padStart(14);
    const v29Str = formatNumber(r.newV29 ?? r.storedV29).padStart(14);
    const errStr = formatPct(r.errorVsUI).padStart(10);
    const statusIcon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';

    console.log(`${r.wallet}  ${uiStr}  ${v29Str}  ${errStr}  ${statusIcon}`);
  }

  if (results.length > 15) {
    console.log(`... and ${results.length - 15} more wallets`);
  }
  console.log('─'.repeat(100));

  // Print aggregate stats
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                           AGGREGATE STATS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`  Total wallets tested:       ${aggregateStats.totalWallets}`);
  console.log(`  Pass (<${ERROR_THRESHOLD_PCT}% error):         ${aggregateStats.passCount} (${aggregateStats.passRatePct.toFixed(1)}%)`);
  console.log(`  Fail (>=${ERROR_THRESHOLD_PCT}% error):        ${aggregateStats.failCount}`);
  console.log(`  Errors:                     ${aggregateStats.errorCount}`);
  console.log('');
  console.log(`  Mean |error| vs UI:         ${formatPct(aggregateStats.meanAbsErrorVsUI)}`);
  console.log(`  Median |error| vs UI:       ${formatPct(aggregateStats.medianAbsErrorVsUI)}`);
  console.log(`  P90 |error| vs UI:          ${formatPct(aggregateStats.p90AbsErrorVsUI)}`);

  // Print V29 comparison if available
  if (v29Available && results.some(r => r.newV29 !== null)) {
    const storedVsNewErrors = results
      .filter(r => r.errorVsStored !== null)
      .map(r => Math.abs(r.errorVsStored!));

    if (storedVsNewErrors.length > 0) {
      const storedStats = computeStats(storedVsNewErrors);
      console.log('\n  V29 stored vs new comparison:');
      console.log(`    Mean |delta|:             ${formatPct(storedStats.mean)}`);
      console.log(`    Median |delta|:           ${formatPct(storedStats.median)}`);
    }
  }

  // Overall result
  console.log('\n═══════════════════════════════════════════════════════════════════');
  if (aggregateStats.passRatePct >= 90) {
    console.log('  ✅ COHORT HEALTHY: V29 engine is performing well on SAFE cohort');
  } else if (aggregateStats.passRatePct >= 70) {
    console.log('  ⚠️  COHORT WARNING: Some regressions detected');
  } else {
    console.log('  ❌ COHORT FAILING: Significant regressions detected');
  }
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Save results
  const outputPath = path.join(process.cwd(), 'tmp/safe_cohort_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    runAt: new Date().toISOString(),
    mode: v29Available ? 'live' : 'stored',
    aggregateStats,
    results,
  }, null, 2));

  console.log(`📄 Results saved to: ${outputPath}\n`);
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
const options = {
  live: args.includes('--live'),
  limit: null as number | null,
};

const limitIdx = args.indexOf('--limit');
if (limitIdx !== -1 && args[limitIdx + 1]) {
  options.limit = parseInt(args[limitIdx + 1], 10);
}

runTests(options).catch(console.error);
