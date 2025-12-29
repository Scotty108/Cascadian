#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * V12 TRIPLE-DEFINITION BENCHMARK - SYNTHETIC VS CASHFULL VS DOMECASH VS DOME
 * ============================================================================
 *
 * Compares THREE realized PnL definitions against Dome API:
 *
 * 1. V12 Synthetic (Cascadian product metric):
 *    - Credits resolution value even without redemption
 *    - Formula: usdc_delta + (token_delta * payout_norm) for resolved
 *    - Used for Polymarket UI comparisons
 *
 * 2. V12CashFull (Internal comprehensive cash ledger):
 *    - All actual USDC cash flows (sells + redemptions + CTF ops)
 *    - Formula: CLOB(dedup) + PayoutRedemption + PositionsMerge + PositionSplit
 *    - Used for internal analytics
 *
 * 3. V12DomeCash (Dome parity validator metric):
 *    - Strict Dome-matching cash flows ONLY
 *    - Formula: CLOB(dedup) + PayoutRedemption (NO PositionsMerge/Split)
 *    - Used ONLY for Dome API validation
 *
 * PURPOSE: Prove DomeCash matches Dome better than other definitions.
 *
 * USAGE:
 *   npx tsx scripts/pnl/benchmark-v12-realized-dual.ts
 *   npx tsx scripts/pnl/benchmark-v12-realized-dual.ts --wallets tmp/clob_50_wallets.json
 *
 * OUTPUT:
 *   - Console summary with 4-way comparison
 *   - tmp/v12_triple_benchmark_results.json
 *   - docs/reports/V12_TRIPLE_BENCHMARK_2025_12_09.md
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import {
  calculateRealizedPnlV12,
  closeClient as closeV12Client,
} from '../../lib/pnl/realizedPnlV12';
import {
  calculateRealizedPnlV12CashFull,
  calculateRealizedPnlV12DomeCash,
  closeClient as closeCashClient,
} from '../../lib/pnl/realizedPnlV12Cash';
import { fetchDomeRealizedPnL } from '../../lib/pnl/domeClient';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_WALLETS_PATH = 'tmp/clob_50_wallets.json';
const ERROR_THRESHOLD_PCT = 5;

// ============================================================================
// Types
// ============================================================================

interface WalletInput {
  wallet_address: string;
  dome_realized?: number;
  dome_confidence?: 'high' | 'low' | 'none';
  is_clob_only?: boolean;
}

interface TripleBenchmarkResult {
  wallet: string;
  // Truth (Dome API)
  domeRealized: number | null;
  domeConfidence: 'high' | 'low' | 'none';

  // V12 Synthetic (product metric)
  v12Synthetic: number;
  v12SyntheticError: number;
  v12SyntheticPass: boolean;

  // V12 CashFull (internal analytics - includes PositionsMerge/Split)
  v12CashFull: number;
  v12CashFullError: number;
  v12CashFullPass: boolean;

  // V12 DomeCash (Dome parity validator - CLOB + PayoutRedemption ONLY)
  v12DomeCash: number;
  v12DomeCashError: number;
  v12DomeCashPass: boolean;

  // Breakdown for analysis
  clobUsdc: number;         // From DomeCash (deduped)
  redemptionUsdc: number;   // PayoutRedemption
  mergeUsdc: number;        // PositionsMerge (CTF redemptions)
  splitUsdc: number;        // PositionSplit (CTF minting)

  // Gaps for analysis
  syntheticGap: number;     // V12Synthetic - V12DomeCash
  cashFullGap: number;      // V12CashFull - V12DomeCash (should = mergeUsdc + splitUsdc)

  // Status
  notes: string[];
}

// ============================================================================
// Main Benchmark Function
// ============================================================================

async function runTripleBenchmark(): Promise<TripleBenchmarkResult[]> {
  console.log('='.repeat(120));
  console.log('V12 TRIPLE-DEFINITION BENCHMARK - SYNTHETIC VS CASHFULL VS DOMECASH VS DOME');
  console.log('='.repeat(120));
  console.log('');
  console.log('DEFINITIONS:');
  console.log('  V12 Synthetic:  usdc_delta + (token_delta * payout_norm) - credits resolution value');
  console.log('  V12 CashFull:   CLOB(dedup) + PayoutRedemption + PositionsMerge + PositionSplit');
  console.log('  V12 DomeCash:   CLOB(dedup) + PayoutRedemption ONLY (Dome parity validator)');
  console.log('');
  console.log('HYPOTHESIS: V12DomeCash should match Dome better than CashFull (excludes Merge/Split)');
  console.log('');

  // Parse CLI args
  const walletsPathArg = process.argv.find((arg) => arg.startsWith('--wallets='));
  const walletsPath = walletsPathArg
    ? walletsPathArg.split('=')[1]
    : DEFAULT_WALLETS_PATH;

  // Load wallets
  if (!fs.existsSync(walletsPath)) {
    console.error(`Wallets file not found: ${walletsPath}`);
    console.log('Creating sample wallet list from Dome fetch...');
    // Will fetch from Dome directly
  }

  let wallets: WalletInput[] = [];
  if (fs.existsSync(walletsPath)) {
    const rawData = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
    wallets = rawData.wallets || rawData;
    console.log(`Loaded ${wallets.length} wallets from ${walletsPath}\n`);
  }

  const results: TripleBenchmarkResult[] = [];

  // Print header (compact for 4-way comparison)
  console.log(
    'Wallet           | Dome       | Synthetic  | CashFull   | DomeCash   | SynthErr | FullErr  | DomeErr  | Result'
  );
  console.log('-'.repeat(120));

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const shortWallet = w.wallet_address.slice(0, 16);

    // Get Dome value
    let domeRealized = w.dome_realized ?? null;
    let domeConfidence: 'high' | 'low' | 'none' = w.dome_confidence || 'none';

    if (domeRealized === null || domeRealized === undefined) {
      const domeResult = await fetchDomeRealizedPnL(w.wallet_address);
      domeRealized = domeResult.realizedPnl;
      domeConfidence = domeResult.confidence;
    }

    // Calculate V12 Synthetic
    const v12SynthResult = await calculateRealizedPnlV12(w.wallet_address);
    const v12Synthetic = v12SynthResult.realizedPnl;

    // Calculate V12 CashFull (CLOB + PayoutRedemption + PositionsMerge + PositionSplit)
    const v12CashFullResult = await calculateRealizedPnlV12CashFull(w.wallet_address);
    const v12CashFull = v12CashFullResult.cashFull;

    // Calculate V12 DomeCash (CLOB + PayoutRedemption ONLY)
    const v12DomeCashResult = await calculateRealizedPnlV12DomeCash(w.wallet_address);
    const v12DomeCash = v12DomeCashResult.domeCash;

    // Calculate errors vs Dome
    let v12SyntheticError = 0;
    let v12CashFullError = 0;
    let v12DomeCashError = 0;

    if (domeRealized !== null && domeRealized !== 0) {
      v12SyntheticError = Math.abs((v12Synthetic - domeRealized) / domeRealized) * 100;
      v12CashFullError = Math.abs((v12CashFull - domeRealized) / domeRealized) * 100;
      v12DomeCashError = Math.abs((v12DomeCash - domeRealized) / domeRealized) * 100;
    } else if (domeRealized === 0) {
      v12SyntheticError = v12Synthetic !== 0 ? 100 : 0;
      v12CashFullError = v12CashFull !== 0 ? 100 : 0;
      v12DomeCashError = v12DomeCash !== 0 ? 100 : 0;
    }

    const v12SyntheticPass = v12SyntheticError < ERROR_THRESHOLD_PCT;
    const v12CashFullPass = v12CashFullError < ERROR_THRESHOLD_PCT;
    const v12DomeCashPass = v12DomeCashError < ERROR_THRESHOLD_PCT;

    const syntheticGap = v12Synthetic - v12DomeCash;
    const cashFullGap = v12CashFull - v12DomeCash; // Should equal mergeUsdc + splitUsdc

    const notes: string[] = [];
    if (domeConfidence === 'none') notes.push('Dome placeholder');
    if (v12DomeCashPass && !v12CashFullPass) notes.push('DomeCash wins over CashFull');
    if (v12DomeCashPass && !v12SyntheticPass) notes.push('DomeCash wins over Synthetic');
    if (Math.abs(cashFullGap) > 100) notes.push('Significant Merge/Split activity');

    const result: TripleBenchmarkResult = {
      wallet: w.wallet_address,
      domeRealized,
      domeConfidence,
      v12Synthetic,
      v12SyntheticError,
      v12SyntheticPass,
      v12CashFull,
      v12CashFullError,
      v12CashFullPass,
      v12DomeCash,
      v12DomeCashError,
      v12DomeCashPass,
      clobUsdc: v12DomeCashResult.clobUsdc,
      redemptionUsdc: v12DomeCashResult.redemptionUsdc,
      mergeUsdc: v12CashFullResult.mergeUsdc,
      splitUsdc: v12CashFullResult.splitUsdc,
      syntheticGap,
      cashFullGap,
      notes,
    };

    results.push(result);

    // Print row
    const domeStr = domeRealized !== null ? `$${Math.round(domeRealized).toString().padStart(9)}` : '      N/A';
    const synthStr = `$${Math.round(v12Synthetic).toString().padStart(9)}`;
    const cashFullStr = `$${Math.round(v12CashFull).toString().padStart(9)}`;
    const domeCashStr = `$${Math.round(v12DomeCash).toString().padStart(9)}`;
    const synthErrStr = `${v12SyntheticError.toFixed(1).padStart(6)}%`;
    const cashFullErrStr = `${v12CashFullError.toFixed(1).padStart(6)}%`;
    const domeCashErrStr = `${v12DomeCashError.toFixed(1).padStart(6)}%`;

    // Result shows which metric matches best
    let resultStr = '✗ FAIL';
    if (v12DomeCashPass) resultStr = '✓ DOME';
    else if (v12CashFullPass) resultStr = '~ Full';
    else if (v12SyntheticPass) resultStr = '~ Synt';

    console.log(
      `${shortWallet} | ${domeStr} | ${synthStr} | ${cashFullStr} | ${domeCashStr} | ${synthErrStr} | ${cashFullErrStr} | ${domeCashErrStr} | ${resultStr}`
    );
  }

  console.log('-'.repeat(120));

  return results;
}

// ============================================================================
// Summary Generation
// ============================================================================

function generateSummary(results: TripleBenchmarkResult[]): void {
  // Filter to only wallets with valid Dome data
  const validResults = results.filter((r) => r.domeRealized !== null && r.domeConfidence !== 'none');

  const synthPassCount = validResults.filter((r) => r.v12SyntheticPass).length;
  const cashFullPassCount = validResults.filter((r) => r.v12CashFullPass).length;
  const domeCashPassCount = validResults.filter((r) => r.v12DomeCashPass).length;

  const avgSynthError =
    validResults.reduce((sum, r) => sum + r.v12SyntheticError, 0) / validResults.length;
  const avgCashFullError =
    validResults.reduce((sum, r) => sum + r.v12CashFullError, 0) / validResults.length;
  const avgDomeCashError =
    validResults.reduce((sum, r) => sum + r.v12DomeCashError, 0) / validResults.length;

  const medianSynthError = [...validResults]
    .sort((a, b) => a.v12SyntheticError - b.v12SyntheticError)
    [Math.floor(validResults.length / 2)]?.v12SyntheticError || 0;
  const medianCashFullError = [...validResults]
    .sort((a, b) => a.v12CashFullError - b.v12CashFullError)
    [Math.floor(validResults.length / 2)]?.v12CashFullError || 0;
  const medianDomeCashError = [...validResults]
    .sort((a, b) => a.v12DomeCashError - b.v12DomeCashError)
    [Math.floor(validResults.length / 2)]?.v12DomeCashError || 0;

  console.log('');
  console.log('='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));
  console.log(`Total Wallets:           ${results.length}`);
  console.log(`Valid Dome Data:         ${validResults.length}`);
  console.log('');
  console.log('V12 SYNTHETIC (credits resolution value):');
  console.log(`  Pass (<5% error):      ${synthPassCount} / ${validResults.length} (${((synthPassCount / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`  Average Error:         ${avgSynthError.toFixed(2)}%`);
  console.log(`  Median Error:          ${medianSynthError.toFixed(2)}%`);
  console.log('');
  console.log('V12 CASHFULL (CLOB + PayoutRedemption + PositionsMerge + PositionSplit):');
  console.log(`  Pass (<5% error):      ${cashFullPassCount} / ${validResults.length} (${((cashFullPassCount / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`  Average Error:         ${avgCashFullError.toFixed(2)}%`);
  console.log(`  Median Error:          ${medianCashFullError.toFixed(2)}%`);
  console.log('');
  console.log('V12 DOMECASH (CLOB + PayoutRedemption ONLY - Dome parity validator):');
  console.log(`  Pass (<5% error):      ${domeCashPassCount} / ${validResults.length} (${((domeCashPassCount / validResults.length) * 100).toFixed(1)}%)`);
  console.log(`  Average Error:         ${avgDomeCashError.toFixed(2)}%`);
  console.log(`  Median Error:          ${medianDomeCashError.toFixed(2)}%`);
  console.log('');

  // Detailed analysis
  const domeCashOnlyMatches = validResults.filter((r) => r.v12DomeCashPass && !r.v12CashFullPass && !r.v12SyntheticPass);
  const cashFullOnlyMatches = validResults.filter((r) => r.v12CashFullPass && !r.v12DomeCashPass && !r.v12SyntheticPass);
  const synthOnlyMatches = validResults.filter((r) => r.v12SyntheticPass && !r.v12DomeCashPass && !r.v12CashFullPass);
  const allMatch = validResults.filter((r) => r.v12DomeCashPass && r.v12CashFullPass && r.v12SyntheticPass);
  const noneMatch = validResults.filter((r) => !r.v12DomeCashPass && !r.v12CashFullPass && !r.v12SyntheticPass);

  console.log('DEFINITION ANALYSIS:');
  console.log(`  All three match Dome:        ${allMatch.length}`);
  console.log(`  Only DomeCash matches:       ${domeCashOnlyMatches.length}`);
  console.log(`  Only CashFull matches:       ${cashFullOnlyMatches.length}`);
  console.log(`  Only Synthetic matches:      ${synthOnlyMatches.length}`);
  console.log(`  None match:                  ${noneMatch.length}`);
  console.log('');

  // Calculate PositionsMerge/Split impact
  const walletsWithMerge = validResults.filter((r) => Math.abs(r.mergeUsdc) > 100);
  const walletsWithSplit = validResults.filter((r) => Math.abs(r.splitUsdc) > 100);
  console.log('CTF ACTIVITY ANALYSIS:');
  console.log(`  Wallets with PositionsMerge > $100:  ${walletsWithMerge.length}`);
  console.log(`  Wallets with PositionSplit > $100:   ${walletsWithSplit.length}`);
  console.log('');

  // Conclusion
  if (domeCashPassCount > cashFullPassCount) {
    console.log('CONCLUSION: V12DomeCash matches Dome BETTER than V12CashFull.');
    console.log('            Excluding PositionsMerge/Split improves Dome parity.');
    console.log('            This confirms: Dome = CLOB + PayoutRedemption ONLY.');
  } else if (domeCashPassCount === cashFullPassCount) {
    console.log('CONCLUSION: V12DomeCash and V12CashFull have similar Dome alignment.');
    console.log('            PositionsMerge/Split may not be significant for this cohort.');
  } else {
    console.log('CONCLUSION: Unexpected - V12CashFull matches Dome better than V12DomeCash.');
    console.log('            Requires investigation.');
  }
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(results: TripleBenchmarkResult[]): string {
  const validResults = results.filter((r) => r.domeRealized !== null && r.domeConfidence !== 'none');
  const synthPassCount = validResults.filter((r) => r.v12SyntheticPass).length;
  const cashFullPassCount = validResults.filter((r) => r.v12CashFullPass).length;
  const domeCashPassCount = validResults.filter((r) => r.v12DomeCashPass).length;

  const avgSynthError =
    validResults.reduce((sum, r) => sum + r.v12SyntheticError, 0) / validResults.length;
  const avgCashFullError =
    validResults.reduce((sum, r) => sum + r.v12CashFullError, 0) / validResults.length;
  const avgDomeCashError =
    validResults.reduce((sum, r) => sum + r.v12DomeCashError, 0) / validResults.length;

  let report = `# V12 Triple-Definition Benchmark Report

**Date:** ${new Date().toISOString().split('T')[0]}
**Terminal:** Claude 1
**Wallets Tested:** ${results.length}
**Valid Dome Data:** ${validResults.length}

## Executive Summary

This benchmark compares THREE realized PnL definitions against Dome API to prove that
the low pass rate is due to a **definition mismatch**, not a calculation error.

| Metric | V12 Synthetic | V12 CashFull | V12 DomeCash |
|--------|---------------|--------------|--------------|
| Pass Rate (<5%) | ${((synthPassCount / validResults.length) * 100).toFixed(1)}% | ${((cashFullPassCount / validResults.length) * 100).toFixed(1)}% | ${((domeCashPassCount / validResults.length) * 100).toFixed(1)}% |
| Avg Error | ${avgSynthError.toFixed(2)}% | ${avgCashFullError.toFixed(2)}% | ${avgDomeCashError.toFixed(2)}% |

## Definition Comparison

| Component | V12 Synthetic | V12 CashFull | V12 DomeCash |
|-----------|---------------|--------------|--------------|
| CLOB trade USDC (deduped) | ✓ | ✓ | ✓ |
| PayoutRedemption USDC | ✓ | ✓ | ✓ |
| PositionsMerge USDC | ✗ | ✓ | ✗ |
| PositionSplit USDC | ✗ | ✓ | ✗ |
| Unredeemed shares × resolution | ✓ (synthetic) | ✗ | ✗ |

**Key Insight:** V12DomeCash excludes PositionsMerge/Split because Dome API does not count CTF operations as realized PnL.

## Detailed Results

| Wallet | Dome | Synthetic | CashFull | DomeCash | SynthErr | FullErr | DomeErr |
|--------|------|-----------|----------|----------|----------|---------|---------|
`;

  for (const r of results.slice(0, 50)) {
    const domeStr = r.domeRealized !== null ? `$${Math.round(r.domeRealized).toLocaleString()}` : 'N/A';
    const synthStr = `$${Math.round(r.v12Synthetic).toLocaleString()}`;
    const cashFullStr = `$${Math.round(r.v12CashFull).toLocaleString()}`;
    const domeCashStr = `$${Math.round(r.v12DomeCash).toLocaleString()}`;

    report += `| ${r.wallet.slice(0, 16)}... | ${domeStr} | ${synthStr} | ${cashFullStr} | ${domeCashStr} | ${r.v12SyntheticError.toFixed(1)}% | ${r.v12CashFullError.toFixed(1)}% | ${r.v12DomeCashError.toFixed(1)}% |\n`;
  }

  report += `
## Cash Flow Breakdown

| Wallet | CLOB(dedup) | Redemption | Merge | Split | DomeCash | CashFull |
|--------|-------------|------------|-------|-------|----------|----------|
`;

  for (const r of results.slice(0, 20)) {
    report += `| ${r.wallet.slice(0, 16)}... | $${Math.round(r.clobUsdc).toLocaleString()} | $${Math.round(r.redemptionUsdc).toLocaleString()} | $${Math.round(r.mergeUsdc).toLocaleString()} | $${Math.round(r.splitUsdc).toLocaleString()} | $${Math.round(r.v12DomeCash).toLocaleString()} | $${Math.round(r.v12CashFull).toLocaleString()} |\n`;
  }

  report += `
## Conclusion

`;

  if (domeCashPassCount > cashFullPassCount) {
    report += `**V12DomeCash matches Dome API BETTER than V12CashFull.**

This confirms the hypothesis:
- **Dome API = CLOB(dedup) + PayoutRedemption ONLY**
- Dome does NOT count PositionsMerge (CTF complete-set redemptions) as realized PnL
- Dome does NOT count PositionSplit (CTF minting) as realized PnL

**Metric Taxonomy:**
- **V12Synthetic**: For Cascadian product metrics (credits unredeemed shares at resolution value)
- **V12CashFull**: For internal analytics (comprehensive cash ledger)
- **V12DomeCash**: For Dome validation ONLY (strict Dome parity validator)
`;
  } else if (domeCashPassCount === cashFullPassCount) {
    report += `V12DomeCash and V12CashFull have similar Dome alignment.
PositionsMerge/Split activity may not be significant for this cohort.
`;
  } else {
    report += `Unexpected: V12CashFull matches Dome better than V12DomeCash.
This requires investigation - our hypothesis about PositionsMerge exclusion may be incorrect.
`;
  }

  return report;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  try {
    const results = await runTripleBenchmark();
    generateSummary(results);

    // Save JSON results
    const jsonPath = 'tmp/v12_triple_benchmark_results.json';
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    console.log(`\nJSON results saved to: ${jsonPath}`);

    // Save markdown report
    const report = generateReport(results);
    const reportPath = `docs/reports/V12_TRIPLE_BENCHMARK_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}.md`;
    fs.writeFileSync(reportPath, report);
    console.log(`Report saved to: ${reportPath}`);

  } finally {
    await closeV12Client();
    await closeCashClient();
  }
}

main().catch(console.error);
