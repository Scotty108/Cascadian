#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE REALIZED VS DOME - Multi-Engine Comparison
 * ============================================================================
 *
 * Validates realized PnL from V11, V29, and V23C against Dome ground truth.
 * Uses unified thresholds from validationThresholds.ts.
 *
 * Input:
 *   tmp/clob_200_wallets.json (from build-clob-200-wallet-set.ts)
 *
 * Output:
 *   tmp/realized_vs_dome_multi.json
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-realized-vs-dome-multi.ts
 *   npx tsx scripts/pnl/validate-realized-vs-dome-multi.ts --input=tmp/clob_50_wallets.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getEngineRegistry, EngineName, PnLResult } from '../../lib/pnl/engines/engineRegistry';
import { isPassDome, DOME_THRESHOLDS, PassResult, calculateBatchStats } from '../../lib/pnl/validationThresholds';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let input = 'tmp/clob_200_wallets.json';
let output = 'tmp/realized_vs_dome_multi.json';

for (const arg of args) {
  if (arg.startsWith('--input=')) input = arg.split('=')[1];
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
}

// ============================================================================
// Types
// ============================================================================

interface WalletInput {
  wallet_address: string;
  dome_realized: number;
  dome_confidence: string;
}

interface EngineValidationResult {
  engine: EngineName;
  ourRealized: number;
  domeRealized: number;
  delta: number;
  pctError: number;
  absError: number;
  passed: boolean;
  failureReason?: string;
  computeTimeMs: number;
}

interface WalletValidationResult {
  wallet_address: string;
  dome_realized: number;
  engines: Record<EngineName, EngineValidationResult>;
  bestEngine: EngineName | null;
  worstEngine: EngineName | null;
}

interface ValidationOutput {
  metadata: {
    generated_at: string;
    input_file: string;
    total_wallets: number;
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
  console.log('VALIDATE REALIZED VS DOME - MULTI-ENGINE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Input: ${input}`);
  console.log(`Output: ${output}`);
  console.log(`Thresholds: ${DOME_THRESHOLDS.pctThreshold}% (large) / $${DOME_THRESHOLDS.absThreshold} (small)`);
  console.log('');

  // Load input
  if (!fs.existsSync(input)) {
    console.error(`Input file not found: ${input}`);
    console.log('Run build-clob-200-wallet-set.ts first');
    process.exit(1);
  }

  const inputData = JSON.parse(fs.readFileSync(input, 'utf-8'));
  const wallets: WalletInput[] = inputData.wallets.map((w: any) => ({
    wallet_address: w.wallet_address,
    dome_realized: w.dome_realized,
    dome_confidence: w.dome_confidence,
  }));

  console.log(`Loaded ${wallets.length} wallets\n`);

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

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    process.stdout.write(`\rProcessing ${i + 1}/${wallets.length}: ${wallet.wallet_address.slice(0, 10)}...`);

    const engineResults = await registry.computeAllEngines(wallet.wallet_address);
    const validations: Record<EngineName, EngineValidationResult> = {} as any;

    for (const engineName of engineNames) {
      const pnlResult = engineResults.get(engineName);
      if (!pnlResult) {
        validations[engineName] = {
          engine: engineName,
          ourRealized: 0,
          domeRealized: wallet.dome_realized,
          delta: -wallet.dome_realized,
          pctError: 100,
          absError: Math.abs(wallet.dome_realized),
          passed: false,
          failureReason: 'ENGINE_ERROR',
          computeTimeMs: 0,
        };
        continue;
      }

      const passResult = isPassDome(wallet.dome_realized, pnlResult.realizedPnl);
      const delta = pnlResult.realizedPnl - wallet.dome_realized;

      validations[engineName] = {
        engine: engineName,
        ourRealized: pnlResult.realizedPnl,
        domeRealized: wallet.dome_realized,
        delta,
        pctError: passResult.pctError,
        absError: passResult.absError,
        passed: passResult.passed,
        failureReason: passResult.failureReason,
        computeTimeMs: pnlResult.computeTimeMs,
      };

      // Track stats
      engineStats[engineName].results.push({
        benchmarkValue: wallet.dome_realized,
        ourValue: pnlResult.realizedPnl,
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
    const stats = calculateBatchStats(engineStats[engineName].results, DOME_THRESHOLDS);
    const avgTime = engineStats[engineName].computeTimes.reduce((a, b) => a + b, 0) / engineStats[engineName].computeTimes.length;

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
      `${bestEngine} has the highest pass rate (${(bestPassRate * 100).toFixed(1)}%) for realized PnL vs Dome`
    );
  }

  // Build output
  const outputData: ValidationOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      input_file: input,
      total_wallets: wallets.length,
      thresholds: {
        pct: DOME_THRESHOLDS.pctThreshold,
        abs: DOME_THRESHOLDS.absThreshold,
        large_pnl_threshold: DOME_THRESHOLDS.largePnlThreshold,
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
  console.log('Pass rates by engine (Realized vs Dome):');
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
        console.log(`  ${f.wallet_address.slice(0, 10)}... Dome=$${f.dome_realized.toFixed(2)} Ours=$${e.ourRealized.toFixed(2)} (${e.failureReason})`);
      }
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
