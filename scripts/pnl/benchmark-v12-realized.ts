#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * V12 REALIZED PNL BENCHMARK - THREE-WAY COMPARISON
 * ============================================================================
 *
 * Compares realized PnL from three sources:
 * 1. V12 (new production-grade engine with V11 fixes)
 * 2. Dome API (external truth source if available)
 * 3. V29 realized component (existing engine's realized portion)
 *
 * USAGE:
 *   npx tsx scripts/pnl/benchmark-v12-realized.ts [--wallets path/to/wallets.json]
 *
 * OUTPUT:
 *   - Console table with comparison
 *   - JSON results saved to tmp/v12_benchmark_results.json
 *   - Markdown report saved to docs/reports/REALIZED_PNL_V12_RECONCILIATION_YYYY_MM_DD.md
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import {
  calculateRealizedPnlV12,
  getRealizedStats,
  closeClient,
  type RealizedPnlResult,
} from '../../lib/pnl/realizedPnlV12';
import { fetchDomeRealizedPnL, type DomeRealizedResult } from '../../lib/pnl/domeClient';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_WALLETS_PATH = 'tmp/apples_v3_maker_only_nodrop.json';
const ERROR_THRESHOLD_PCT = 5; // Pass if error < 5%
const COMPARABLE_THRESHOLD_PCT = 50; // Only compare if unresolved < 50%

// ============================================================================
// Types
// ============================================================================

interface WalletTruth {
  wallet: string;
  uiPnl: number;
  v9NodropPnl?: number;
  v8Pnl?: number;
}

interface BenchmarkResult {
  wallet: string;
  // Truth (from UI snapshot)
  uiPnl: number;

  // V12 Results
  v12RealizedPnl: number;
  v12EventCount: number;
  v12ResolvedEvents: number;
  v12UnresolvedPct: number;
  v12IsComparable: boolean;
  v12ErrorPct: number;
  v12Pass: boolean;

  // Dome Results
  domeRealizedPnl: number | null;
  domeConfidence: 'high' | 'low' | 'none';
  domeErrorPct: number | null;
  domePass: boolean | null;

  // V29 Realized (if available)
  v29RealizedPnl: number | null;
  v29ErrorPct: number | null;
  v29Pass: boolean | null;

  // Verdict
  verdict: 'pass' | 'fail' | 'not_comparable' | 'error';
  notes: string[];
}

// ============================================================================
// V29 Realized PnL Extraction
// ============================================================================

/**
 * Extract just the realized portion from V29 engine.
 * Note: V29 tracks realized separately from unrealized.
 */
async function getV29RealizedPnl(wallet: string): Promise<number | null> {
  try {
    // Dynamic import to avoid circular deps
    const { calculateV29ForWallet } = await import('../../lib/pnl/inventoryEngineV29');
    const result = await calculateV29ForWallet(wallet, { ledgerSource: 'v8' });
    return result.realizedPnl;
  } catch (error) {
    // V29 not available or errored
    return null;
  }
}

// ============================================================================
// Main Benchmark Function
// ============================================================================

async function runBenchmark(walletsPath: string): Promise<BenchmarkResult[]> {
  console.log('='.repeat(100));
  console.log('V12 REALIZED PNL BENCHMARK - THREE-WAY COMPARISON');
  console.log('='.repeat(100));
  console.log('');

  // Load wallets
  if (!fs.existsSync(walletsPath)) {
    console.error(`Wallets file not found: ${walletsPath}`);
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
  const wallets: WalletTruth[] = Array.isArray(rawData)
    ? rawData
    : Object.values(rawData);

  console.log(`Loaded ${wallets.length} wallets from ${walletsPath}\n`);

  const results: BenchmarkResult[] = [];

  // Print header
  console.log('Wallet           | UI PnL      | V12 PnL     | Dome PnL    | Unres% | V12 Err | Verdict');
  console.log('-'.repeat(100));

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const shortWallet = w.wallet.slice(0, 16);

    // Calculate V12 realized PnL
    const v12Result = await calculateRealizedPnlV12(w.wallet);

    // Fetch Dome realized PnL
    const domeResult = await fetchDomeRealizedPnL(w.wallet);

    // Get V29 realized PnL (if available)
    let v29Realized: number | null = null;
    try {
      v29Realized = await getV29RealizedPnl(w.wallet);
    } catch {
      // Ignore V29 errors
    }

    // Calculate errors
    const v12Error = w.uiPnl !== 0 ? Math.abs((v12Result.realizedPnl - w.uiPnl) / w.uiPnl * 100) : 0;
    const v12Pass = v12Error < ERROR_THRESHOLD_PCT;

    const domeError = domeResult.realizedPnl !== null && w.uiPnl !== 0
      ? Math.abs((domeResult.realizedPnl - w.uiPnl) / w.uiPnl * 100)
      : null;
    const domePass = domeError !== null ? domeError < ERROR_THRESHOLD_PCT : null;

    const v29Error = v29Realized !== null && w.uiPnl !== 0
      ? Math.abs((v29Realized - w.uiPnl) / w.uiPnl * 100)
      : null;
    const v29Pass = v29Error !== null ? v29Error < ERROR_THRESHOLD_PCT : null;

    // Determine verdict
    let verdict: 'pass' | 'fail' | 'not_comparable' | 'error' = 'fail';
    const notes: string[] = [];

    if (v12Result.errors.length > 0) {
      verdict = 'error';
      notes.push(...v12Result.errors);
    } else if (!v12Result.isComparable) {
      verdict = 'not_comparable';
      notes.push(`Unresolved ${v12Result.unresolvedPct.toFixed(1)}% > 50% threshold`);
    } else if (v12Pass) {
      verdict = 'pass';
    } else {
      verdict = 'fail';
      notes.push(`V12 error ${v12Error.toFixed(1)}% > ${ERROR_THRESHOLD_PCT}% threshold`);
    }

    const result: BenchmarkResult = {
      wallet: w.wallet,
      uiPnl: w.uiPnl,

      v12RealizedPnl: v12Result.realizedPnl,
      v12EventCount: v12Result.eventCount,
      v12ResolvedEvents: v12Result.resolvedEvents,
      v12UnresolvedPct: v12Result.unresolvedPct,
      v12IsComparable: v12Result.isComparable,
      v12ErrorPct: v12Error,
      v12Pass,

      domeRealizedPnl: domeResult.realizedPnl,
      domeConfidence: domeResult.confidence,
      domeErrorPct: domeError,
      domePass,

      v29RealizedPnl: v29Realized,
      v29ErrorPct: v29Error,
      v29Pass,

      verdict,
      notes,
    };

    results.push(result);

    // Print row
    const v12Sym = v12Pass ? '✓' : (verdict === 'not_comparable' ? '~' : '✗');
    const domeStr = domeResult.realizedPnl !== null
      ? `$${Math.round(domeResult.realizedPnl).toString().padStart(9)}`
      : '       N/A';

    console.log(
      `${shortWallet} | $${Math.round(w.uiPnl).toString().padStart(9)} | $${Math.round(v12Result.realizedPnl).toString().padStart(9)} ${v12Sym} | ${domeStr} | ${v12Result.unresolvedPct.toFixed(1).padStart(5)}% | ${v12Error.toFixed(1).padStart(5)}% | ${verdict}`
    );
  }

  console.log('-'.repeat(100));

  return results;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(results: BenchmarkResult[]): string {
  const now = new Date().toISOString().split('T')[0];

  const passCount = results.filter(r => r.verdict === 'pass').length;
  const failCount = results.filter(r => r.verdict === 'fail').length;
  const notComparableCount = results.filter(r => r.verdict === 'not_comparable').length;
  const errorCount = results.filter(r => r.verdict === 'error').length;

  const comparableResults = results.filter(r => r.v12IsComparable);
  const comparablePassCount = comparableResults.filter(r => r.v12Pass).length;
  const rawPassRate = (passCount / results.length * 100).toFixed(1);
  const comparablePassRate = comparableResults.length > 0
    ? (comparablePassCount / comparableResults.length * 100).toFixed(1)
    : '0';

  let report = `# Realized PnL V12 Reconciliation Report

**Date:** ${now}
**Engine:** V12 (production-grade realized-only)
**Wallets Tested:** ${results.length}

## Summary

| Metric | Value |
|--------|-------|
| Total Wallets | ${results.length} |
| Pass (<5% error) | ${passCount} |
| Fail (>=5% error) | ${failCount} |
| Not Comparable (>50% unresolved) | ${notComparableCount} |
| Errors | ${errorCount} |
| **Raw Pass Rate** | **${rawPassRate}%** |
| **Comparable Pass Rate** | **${comparablePassRate}%** (${comparablePassCount}/${comparableResults.length}) |

## Methodology

V12 calculates realized PnL using:
1. Source: \`pm_trader_events_v2\` (complete CLOB events)
2. Dedup: Query-time GROUP BY event_id with argMax pattern
3. Join: \`pm_token_to_condition_map_v5\` for condition/outcome mapping
4. Join: \`pm_condition_resolutions\` for payout info
5. Critical fix: Empty string payout_numerators treated as unresolved

**Formula:**
\`\`\`
realized_pnl = usdc_delta + (token_delta * payout_norm)
WHERE payout_numerators IS NOT NULL
  AND payout_numerators != ''
  AND outcome_index IS NOT NULL
\`\`\`

## Detailed Results

| Wallet | UI PnL | V12 Realized | Unresolved % | Error % | Verdict |
|--------|--------|--------------|--------------|---------|---------|
`;

  for (const r of results) {
    const shortWallet = r.wallet.slice(0, 20) + '...';
    report += `| ${shortWallet} | $${Math.round(r.uiPnl).toLocaleString()} | $${Math.round(r.v12RealizedPnl).toLocaleString()} | ${r.v12UnresolvedPct.toFixed(1)}% | ${r.v12ErrorPct.toFixed(1)}% | ${r.verdict} |\n`;
  }

  report += `
## Observations

### Wallets Not Comparable (>50% Unresolved)

These wallets have significant open positions and should not be compared for realized-only metrics:

`;

  const notComparable = results.filter(r => r.verdict === 'not_comparable');
  for (const r of notComparable) {
    report += `- \`${r.wallet.slice(0, 20)}...\` - ${r.v12UnresolvedPct.toFixed(1)}% unresolved\n`;
  }

  report += `
### Failures Analysis

`;

  const failures = results.filter(r => r.verdict === 'fail');
  if (failures.length === 0) {
    report += 'No failures among comparable wallets.\n';
  } else {
    for (const r of failures) {
      report += `- \`${r.wallet.slice(0, 20)}...\` - UI=$${Math.round(r.uiPnl)}, V12=$${Math.round(r.v12RealizedPnl)}, Error=${r.v12ErrorPct.toFixed(1)}%\n`;
    }
  }

  report += `
## Conclusion

V12 achieves **${comparablePassRate}%** accuracy on comparable wallets (those with <50% unresolved positions).

This engine is recommended for production use when calculating realized PnL for CLOB-only activity on resolved markets.
`;

  return report;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  let walletsPath = DEFAULT_WALLETS_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wallets' && args[i + 1]) {
      walletsPath = args[i + 1];
    }
  }

  try {
    const results = await runBenchmark(walletsPath);

    // Calculate summary stats
    const passCount = results.filter(r => r.verdict === 'pass').length;
    const failCount = results.filter(r => r.verdict === 'fail').length;
    const notComparableCount = results.filter(r => r.verdict === 'not_comparable').length;

    const comparableResults = results.filter(r => r.v12IsComparable);
    const comparablePassCount = comparableResults.filter(r => r.v12Pass).length;

    console.log('');
    console.log('='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));
    console.log(`Total Wallets:       ${results.length}`);
    console.log(`Pass (<5% error):    ${passCount}`);
    console.log(`Fail (>=5% error):   ${failCount}`);
    console.log(`Not Comparable:      ${notComparableCount} (>50% unresolved)`);
    console.log('');
    console.log(`RAW PASS RATE:       ${passCount}/${results.length} (${(passCount / results.length * 100).toFixed(1)}%)`);
    console.log(`COMPARABLE PASS RATE: ${comparablePassCount}/${comparableResults.length} (${(comparablePassCount / comparableResults.length * 100).toFixed(1)}%)`);
    console.log('');

    // Save JSON results
    const jsonPath = 'tmp/v12_benchmark_results.json';
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${jsonPath}`);

    // Generate and save markdown report
    const report = generateReport(results);
    const now = new Date().toISOString().split('T')[0].replace(/-/g, '_');
    const reportPath = `docs/reports/REALIZED_PNL_V12_RECONCILIATION_${now}.md`;
    fs.writeFileSync(reportPath, report);
    console.log(`Report saved to: ${reportPath}`);

  } finally {
    await closeClient();
  }
}

main().catch(console.error);
