#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE TOTAL VS UI - Multi-Engine Comparison
 * ============================================================================
 *
 * Validates total PnL from V11, V29, and V23C against UI ground truth.
 * Uses unified thresholds from validationThresholds.ts.
 *
 * Inputs:
 *   tmp/clob_200_wallets.json (from build-clob-200-wallet-set.ts)
 *   tmp/ui_total_pnl_clob_200.json (from scrape-ui-pnl.ts)
 *
 * Output:
 *   tmp/total_vs_ui_multi.json
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-total-vs-ui-multi.ts
 *   npx tsx scripts/pnl/validate-total-vs-ui-multi.ts --ui=tmp/custom_ui.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getEngineRegistry, EngineName, PnLResult } from '../../lib/pnl/engines/engineRegistry';
import { isPassUI, UI_THRESHOLDS, PassResult, calculateBatchStats } from '../../lib/pnl/validationThresholds';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let input = 'tmp/clob_200_wallets.json';
let uiFile = 'tmp/ui_total_pnl_clob_200.json';
let output = 'tmp/total_vs_ui_multi.json';

for (const arg of args) {
  if (arg.startsWith('--input=')) input = arg.split('=')[1];
  if (arg.startsWith('--ui=')) uiFile = arg.split('=')[1];
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
}

// ============================================================================
// Types
// ============================================================================

interface WalletInput {
  wallet_address: string;
  dome_realized: number;
}

interface UIResult {
  wallet_address: string;
  ui_total_pnl: number | null;
}

interface EngineValidationResult {
  engine: EngineName;
  ourTotal: number;
  uiTotal: number;
  delta: number;
  pctError: number;
  absError: number;
  passed: boolean;
  failureReason?: string;
  computeTimeMs: number;
}

interface WalletValidationResult {
  wallet_address: string;
  ui_total_pnl: number;
  dome_realized: number;
  engines: Record<EngineName, EngineValidationResult>;
  bestEngine: EngineName | null;
  worstEngine: EngineName | null;
}

interface ValidationOutput {
  metadata: {
    generated_at: string;
    input_file: string;
    ui_file: string;
    total_wallets: number;
    wallets_with_ui_pnl: number;
    thresholds: {
      pct: number;
      abs: number;
      large_pnl_threshold: number;
    };
  };
  summary: {
    by_engine: Record<EngineName, {
      total: number;
      passed: number;
      failed: number;
      passRate: number;
      medianPctError: number;
      medianAbsError: number;
      avgComputeTimeMs: number;
    }>;
    bestEngine: EngineName | null;
    recommendations: string[];
  };
  results: WalletValidationResult[];
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('VALIDATE TOTAL VS UI - MULTI-ENGINE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Input: ${input}`);
  console.log(`UI File: ${uiFile}`);
  console.log(`Output: ${output}`);
  console.log(`Thresholds: ${UI_THRESHOLDS.pctThreshold}% (large) / $${UI_THRESHOLDS.absThreshold} (small)`);
  console.log('');

  // Load input wallets
  if (!fs.existsSync(input)) {
    console.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets: WalletInput[] = inputData.wallets.map((w: any) => ({
    wallet_address: w.wallet_address.toLowerCase(),
    dome_realized: w.dome_realized,
  }));

  // Load UI PnL data
  if (!fs.existsSync(uiFile)) {
    console.error(`UI file not found: ${uiFile}`);
    console.log('Run scrape-ui-pnl.ts first');
    process.exit(1);
  }

  const uiData = JSON.parse(fs.readFileSync(uiFile, 'utf-8'));
  const uiMap = new Map<string, number>();
  for (const r of uiData.results as UIResult[]) {
    if (r.ui_total_pnl !== null) {
      uiMap.set(r.wallet_address.toLowerCase(), r.ui_total_pnl);
    }
  }

  // Filter to wallets with UI PnL
  const walletsWithUI = wallets.filter(w => uiMap.has(w.wallet_address));
  console.log(`Loaded ${wallets.length} wallets, ${walletsWithUI.length} have UI PnL\n`);

  if (walletsWithUI.length === 0) {
    console.error('No wallets have UI PnL data');
    process.exit(1);
  }

  // Get engine registry
  const registry = getEngineRegistry();
  const engineNames: EngineName[] = ['V11', 'V29', 'V23C'];

  // Process wallets
  const results: WalletValidationResult[] = [];
  const engineStats: Record<EngineName, {
    results: Array<{ benchmarkValue: number; ourValue: number; passed: boolean; failureReason?: string }>;
    computeTimes: number[];
  }> = {
    V11: { results: [], computeTimes: [] },
    V29: { results: [], computeTimes: [] },
    V23C: { results: [], computeTimes: [] },
  };

  for (let i = 0; i < walletsWithUI.length; i++) {
    const wallet = walletsWithUI[i];
    const uiTotalPnl = uiMap.get(wallet.wallet_address)!;

    process.stdout.write(`\rProcessing ${i + 1}/${walletsWithUI.length}: ${wallet.wallet_address.slice(0, 10)}...`);

    const engineResults = await registry.computeAllEngines(wallet.wallet_address);
    const validations: Record<EngineName, EngineValidationResult> = {} as any;

    for (const engineName of engineNames) {
      const pnlResult = engineResults.get(engineName);
      if (!pnlResult) {
        validations[engineName] = {
          engine: engineName,
          ourTotal: 0,
          uiTotal: uiTotalPnl,
          delta: -uiTotalPnl,
          pctError: 100,
          absError: Math.abs(uiTotalPnl),
          passed: false,
          failureReason: 'ENGINE_ERROR',
          computeTimeMs: 0,
        };
        continue;
      }

      const passResult = isPassUI(uiTotalPnl, pnlResult.totalPnl);
      const delta = pnlResult.totalPnl - uiTotalPnl;

      validations[engineName] = {
        engine: engineName,
        ourTotal: pnlResult.totalPnl,
        uiTotal: uiTotalPnl,
        delta,
        pctError: passResult.pctError,
        absError: passResult.absError,
        passed: passResult.passed,
        failureReason: passResult.failureReason,
        computeTimeMs: pnlResult.computeTimeMs,
      };

      // Track stats
      engineStats[engineName].results.push({
        benchmarkValue: uiTotalPnl,
        ourValue: pnlResult.totalPnl,
        passed: passResult.passed,
        failureReason: passResult.failureReason,
      });
      engineStats[engineName].computeTimes.push(pnlResult.computeTimeMs);
    }

    // Determine best and worst engine for this wallet
    const enginesByError = engineNames
      .map(e => ({ engine: e, pctError: validations[e].pctError }))
      .sort((a, b) => a.pctError - b.pctError);

    results.push({
      wallet_address: wallet.wallet_address,
      ui_total_pnl: uiTotalPnl,
      dome_realized: wallet.dome_realized,
      engines: validations,
      bestEngine: enginesByError[0].engine,
      worstEngine: enginesByError[enginesByError.length - 1].engine,
    });
  }

  console.log('\n\n');

  // Calculate summary stats
  const summary: ValidationOutput['summary'] = {
    by_engine: {} as any,
    bestEngine: null,
    recommendations: [],
  };

  let bestPassRate = 0;
  let bestEngine: EngineName | null = null;

  for (const engineName of engineNames) {
    const stats = calculateBatchStats(engineStats[engineName].results, UI_THRESHOLDS);
    const avgTime = engineStats[engineName].computeTimes.length > 0
      ? engineStats[engineName].computeTimes.reduce((a, b) => a + b, 0) / engineStats[engineName].computeTimes.length
      : 0;

    summary.by_engine[engineName] = {
      total: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      passRate: stats.passRate,
      medianPctError: stats.medianPctError,
      medianAbsError: stats.medianAbsError,
      avgComputeTimeMs: Math.round(avgTime),
    };

    if (stats.passRate > bestPassRate) {
      bestPassRate = stats.passRate;
      bestEngine = engineName;
    }
  }

  summary.bestEngine = bestEngine;

  // Generate recommendations
  if (bestEngine) {
    summary.recommendations.push(
      `${bestEngine} has the highest pass rate (${(bestPassRate * 100).toFixed(1)}%) for total PnL vs UI`
    );
  }

  // Build output
  const outputData: ValidationOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: input,
      ui_file: uiFile,
      total_wallets: wallets.length,
      wallets_with_ui_pnl: walletsWithUI.length,
      thresholds: {
        pct: UI_THRESHOLDS.pctThreshold,
        abs: UI_THRESHOLDS.absThreshold,
        large_pnl_threshold: UI_THRESHOLDS.largePnlThreshold,
      },
    },
    summary,
    results,
  };

  // Write output
  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));

  // Print summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('Pass rates by engine (Total vs UI):');
  console.log('');

  for (const engineName of engineNames) {
    const s = summary.by_engine[engineName];
    const badge = engineName === bestEngine ? ' ***BEST***' : '';
    console.log(`  ${engineName}:${badge}`);
    console.log(`    Pass rate: ${(s.passRate * 100).toFixed(1)}% (${s.passed}/${s.total})`);
    console.log(`    Median % error: ${s.medianPctError.toFixed(2)}%`);
    console.log(`    Median $ error: $${s.medianAbsError.toFixed(2)}`);
    console.log(`    Avg compute time: ${s.avgComputeTimeMs}ms`);
    console.log('');
  }

  console.log(`Output: ${output}`);
  console.log('');

  // Show top failures for each engine
  console.log('='.repeat(80));
  console.log('TOP 3 FAILURES BY ENGINE');
  console.log('='.repeat(80));

  for (const engineName of engineNames) {
    const failures = results
      .filter(r => !r.engines[engineName].passed)
      .sort((a, b) => b.engines[engineName].absError - a.engines[engineName].absError)
      .slice(0, 3);

    if (failures.length > 0) {
      console.log(`\n${engineName}:`);
      for (const f of failures) {
        const e = f.engines[engineName];
        console.log(`  ${f.wallet_address.slice(0, 10)}... UI=$${f.ui_total_pnl.toFixed(2)} Ours=$${e.ourTotal.toFixed(2)} (${e.failureReason})`);
      }
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
