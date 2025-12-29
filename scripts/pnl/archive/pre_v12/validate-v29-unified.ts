#!/usr/bin/env npx tsx
/**
 * V29 Unified Validation - One Engine, Two Valuation Modes
 *
 * This script validates V29 with both valuation modes against Polymarket UI:
 *
 * 1. valuationMode: "ui" - Marks unrealized at live prices (for UI parity validation)
 * 2. valuationMode: "economic" - Marks unrealized at $0.50 (for leaderboard ranking)
 *
 * Key insight: V29's "economic" mode won't match UI for wallets with open positions.
 * This is INTENTIONAL - we want conservative valuation for the leaderboard.
 *
 * For UI parity: Use V29 with valuationMode: "ui"
 * For leaderboard: Use V29 with valuationMode: "economic" and rank by realizedPnl
 */

import { calculateV29PnL, V29Result } from '../../lib/pnl/inventoryEngineV29';
import fs from 'fs';

interface ValidationResult {
  wallet: string;
  uiPnl: number | null;
  v29Economic: {
    realizedPnl: number;
    unrealizedPnl: number;
    resolvedUnredeemedValue: number;
    uiParityPnl: number;
    totalPnl: number;
    openPositions: number;
    error?: string;
  } | null;
  v29UI: {
    realizedPnl: number;
    unrealizedPnl: number;
    resolvedUnredeemedValue: number;
    uiParityPnl: number;
    totalPnl: number;
    openPositions: number;
    error?: string;
  } | null;
  comparison: {
    economic_vs_ui_error: number | null;
    economic_vs_ui_error_pct: number | null;
    economic_passes: boolean;
    ui_mode_vs_ui_error: number | null;
    ui_mode_vs_ui_error_pct: number | null;
    ui_mode_passes: boolean;
    has_open_positions: boolean;
  };
}

const TOLERANCE_PCT = 0.06; // 6% tolerance

function calculateErrorPct(calculated: number, ui: number): number | null {
  if (Math.abs(ui) < 100) return null; // Skip small PnL values
  return (calculated - ui) / Math.abs(ui);
}

function passes(errorPct: number | null): boolean {
  if (errorPct === null) return true; // Skip small values
  return Math.abs(errorPct) < TOLERANCE_PCT;
}

async function validateWallet(wallet: string, uiPnl: number | null): Promise<ValidationResult> {
  let v29Economic: ValidationResult['v29Economic'] = null;
  let v29UI: ValidationResult['v29UI'] = null;

  // Calculate V29 with economic mode (default)
  try {
    const result = await calculateV29PnL(wallet, {
      inventoryGuard: true,
      valuationMode: 'economic',
    });
    v29Economic = {
      realizedPnl: result.realizedPnl,
      unrealizedPnl: result.unrealizedPnl,
      resolvedUnredeemedValue: result.resolvedUnredeemedValue,
      uiParityPnl: result.uiParityPnl,
      totalPnl: result.totalPnl,
      openPositions: result.openPositions,
    };
  } catch (err: any) {
    v29Economic = {
      realizedPnl: 0,
      unrealizedPnl: 0,
      resolvedUnredeemedValue: 0,
      uiParityPnl: 0,
      totalPnl: 0,
      openPositions: 0,
      error: err.message,
    };
  }

  // Calculate V29 with UI mode
  try {
    const result = await calculateV29PnL(wallet, {
      inventoryGuard: true,
      valuationMode: 'ui',
    });
    v29UI = {
      realizedPnl: result.realizedPnl,
      unrealizedPnl: result.unrealizedPnl,
      resolvedUnredeemedValue: result.resolvedUnredeemedValue,
      uiParityPnl: result.uiParityPnl,
      totalPnl: result.totalPnl,
      openPositions: result.openPositions,
    };
  } catch (err: any) {
    v29UI = {
      realizedPnl: 0,
      unrealizedPnl: 0,
      resolvedUnredeemedValue: 0,
      uiParityPnl: 0,
      totalPnl: 0,
      openPositions: 0,
      error: err.message,
    };
  }

  // Compare against UI
  const economic_vs_ui_error_pct = uiPnl !== null && v29Economic
    ? calculateErrorPct(v29Economic.uiParityPnl, uiPnl)
    : null;
  const ui_mode_vs_ui_error_pct = uiPnl !== null && v29UI
    ? calculateErrorPct(v29UI.uiParityPnl, uiPnl)
    : null;

  return {
    wallet,
    uiPnl,
    v29Economic,
    v29UI,
    comparison: {
      economic_vs_ui_error: uiPnl !== null && v29Economic ? v29Economic.uiParityPnl - uiPnl : null,
      economic_vs_ui_error_pct,
      economic_passes: passes(economic_vs_ui_error_pct),
      ui_mode_vs_ui_error: uiPnl !== null && v29UI ? v29UI.uiParityPnl - uiPnl : null,
      ui_mode_vs_ui_error_pct,
      ui_mode_passes: passes(ui_mode_vs_ui_error_pct),
      has_open_positions: (v29Economic?.openPositions ?? 0) > 0,
    },
  };
}

async function main() {
  const inputPath = process.argv[2] || 'tmp/clob_only_from_snapshot.json';
  const outputPath = process.argv[3] || 'tmp/v29_unified_validation.json';
  const limitArg = parseInt(process.argv[4]) || 40;

  console.log('='.repeat(80));
  console.log('V29 UNIFIED VALIDATION - One Engine, Two Valuation Modes');
  console.log('='.repeat(80));
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Limit: ${limitArg} wallets`);
  console.log(`Tolerance: ${TOLERANCE_PCT * 100}%`);
  console.log();

  // Load input
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.log('Run: npx tsx scripts/pnl/check-snapshot-clob-only.ts first');
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const wallets = (input.wallets || []).slice(0, limitArg);

  console.log(`Processing ${wallets.length} wallets...\n`);

  const results: ValidationResult[] = [];
  let processed = 0;

  for (const w of wallets) {
    processed++;
    process.stdout.write(`\r[${processed}/${wallets.length}] ${w.wallet.slice(0, 12)}...`);

    try {
      const result = await validateWallet(w.wallet, w.uiPnl);
      results.push(result);
    } catch (err: any) {
      console.log(`\nError processing ${w.wallet}: ${err.message}`);
    }
  }

  console.log('\n');

  // Calculate summary statistics
  const withUI = results.filter(r => r.uiPnl !== null && Math.abs(r.uiPnl) >= 100);
  const withOpenPositions = withUI.filter(r => r.comparison.has_open_positions);
  const withClosedPositions = withUI.filter(r => !r.comparison.has_open_positions);

  const economicPasses = withUI.filter(r => r.comparison.economic_passes);
  const uiModePasses = withUI.filter(r => r.comparison.ui_mode_passes);

  // For closed-position wallets, both modes should match
  const closedEconomicPasses = withClosedPositions.filter(r => r.comparison.economic_passes);
  const closedUIModePasses = withClosedPositions.filter(r => r.comparison.ui_mode_passes);

  // For open-position wallets, only UI mode should match
  const openEconomicPasses = withOpenPositions.filter(r => r.comparison.economic_passes);
  const openUIModePasses = withOpenPositions.filter(r => r.comparison.ui_mode_passes);

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets processed: ${results.length}`);
  console.log(`Wallets with |UI PnL| >= $100: ${withUI.length}`);
  console.log(`  - With open positions: ${withOpenPositions.length}`);
  console.log(`  - Fully closed: ${withClosedPositions.length}`);
  console.log();

  console.log('--- OVERALL PASS RATES ---');
  console.log(`Economic mode: ${economicPasses.length}/${withUI.length} (${(economicPasses.length / withUI.length * 100).toFixed(1)}%)`);
  console.log(`UI mode:       ${uiModePasses.length}/${withUI.length} (${(uiModePasses.length / withUI.length * 100).toFixed(1)}%)`);
  console.log();

  console.log('--- FULLY CLOSED WALLETS (should match in both modes) ---');
  console.log(`Economic mode: ${closedEconomicPasses.length}/${withClosedPositions.length} (${withClosedPositions.length > 0 ? (closedEconomicPasses.length / withClosedPositions.length * 100).toFixed(1) : 0}%)`);
  console.log(`UI mode:       ${closedUIModePasses.length}/${withClosedPositions.length} (${withClosedPositions.length > 0 ? (closedUIModePasses.length / withClosedPositions.length * 100).toFixed(1) : 0}%)`);
  console.log();

  console.log('--- OPEN POSITION WALLETS (only UI mode should match) ---');
  console.log(`Economic mode: ${openEconomicPasses.length}/${withOpenPositions.length} (${withOpenPositions.length > 0 ? (openEconomicPasses.length / withOpenPositions.length * 100).toFixed(1) : 0}%)`);
  console.log(`UI mode:       ${openUIModePasses.length}/${withOpenPositions.length} (${withOpenPositions.length > 0 ? (openUIModePasses.length / withOpenPositions.length * 100).toFixed(1) : 0}%)`);

  // Show top failures in UI mode (these are real data issues)
  console.log('\n--- TOP 5 UI MODE FAILURES (data quality issues) ---');
  const uiModeFailures = withUI.filter(r => !r.comparison.ui_mode_passes)
    .sort((a, b) => Math.abs(b.comparison.ui_mode_vs_ui_error_pct || 0) - Math.abs(a.comparison.ui_mode_vs_ui_error_pct || 0));

  for (const r of uiModeFailures.slice(0, 5)) {
    const openStatus = r.comparison.has_open_positions ? 'OPEN' : 'CLOSED';
    console.log(`${r.wallet.slice(0, 12)}... [${openStatus}] | UI: $${r.uiPnl?.toLocaleString()} | V29-UI: $${r.v29UI?.uiParityPnl.toLocaleString()} | Error: ${((r.comparison.ui_mode_vs_ui_error_pct || 0) * 100).toFixed(1)}%`);
  }

  // Show sample of economic vs UI mode difference
  console.log('\n--- V29 ECONOMIC vs UI MODE COMPARISON (sample) ---');
  for (const r of results.slice(0, 10)) {
    const economicVal = r.v29Economic?.uiParityPnl || 0;
    const uiModeVal = r.v29UI?.uiParityPnl || 0;
    const diff = uiModeVal - economicVal;
    const openStatus = r.comparison.has_open_positions ? 'OPEN' : 'CLOSED';
    console.log(`${r.wallet.slice(0, 12)}... [${openStatus}] | Economic: $${economicVal.toFixed(0)} | UI: $${uiModeVal.toFixed(0)} | Diff: $${diff.toFixed(0)}`);
  }

  // Leaderboard preview (using economic mode realizedPnl)
  console.log('\n--- LEADERBOARD PREVIEW (economic mode, rank by realizedPnl) ---');
  const leaderboard = results
    .filter(r => r.v29Economic && !r.v29Economic.error)
    .sort((a, b) => (b.v29Economic?.realizedPnl || 0) - (a.v29Economic?.realizedPnl || 0))
    .slice(0, 10);

  for (let i = 0; i < leaderboard.length; i++) {
    const r = leaderboard[i];
    const openStatus = r.comparison.has_open_positions ? 'OPEN' : 'CLOSED';
    console.log(`#${i + 1} ${r.wallet.slice(0, 12)}... [${openStatus}] | Realized: $${r.v29Economic?.realizedPnl.toLocaleString()} | Total: $${r.v29Economic?.totalPnl.toLocaleString()}`);
  }

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      tolerance_pct: TOLERANCE_PCT,
      total_wallets: results.length,
      with_ui_above_100: withUI.length,
      with_open_positions: withOpenPositions.length,
      with_closed_positions: withClosedPositions.length,
    },
    summary: {
      economic_mode_pass_rate: withUI.length > 0 ? economicPasses.length / withUI.length : 0,
      ui_mode_pass_rate: withUI.length > 0 ? uiModePasses.length / withUI.length : 0,
      closed_economic_pass_rate: withClosedPositions.length > 0 ? closedEconomicPasses.length / withClosedPositions.length : 0,
      closed_ui_pass_rate: withClosedPositions.length > 0 ? closedUIModePasses.length / withClosedPositions.length : 0,
      open_economic_pass_rate: withOpenPositions.length > 0 ? openEconomicPasses.length / withOpenPositions.length : 0,
      open_ui_pass_rate: withOpenPositions.length > 0 ? openUIModePasses.length / withOpenPositions.length : 0,
    },
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(console.error);
