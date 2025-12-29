#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * RUN UNIFIED SCORECARD - Complete Engine Validation
 * ============================================================================
 *
 * THE single entrypoint for evaluating all PnL engines against all benchmarks.
 * Produces a comprehensive scorecard showing:
 * - V11 vs Dome (realized-to-realized)
 * - V29 vs Dome (realized-to-realized)
 * - Engine comparison by cohort
 * - Production cohort recommendations
 *
 * Usage:
 *   npx tsx scripts/pnl/run-unified-scorecard.ts [options]
 *
 * Options:
 *   --cohorts=LIST     Comma-separated cohort list (default: all)
 *   --engines=LIST     Comma-separated engines (default: v11,v29)
 *   --manifest=PATH    Path to cohort manifest (default: tmp/pnl_cohort_manifest.json)
 *   --output=PATH      Output report path (default: tmp/unified_scorecard.json)
 *   --limit=N          Max wallets per cohort (default: 100)
 *   --skip-build       Skip manifest rebuild
 *
 * Terminal: Claude 1 (Main Terminal)
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';
import {
  isPass,
  DOME_THRESHOLDS,
  ThresholdConfig,
  calculateBatchStats,
  BatchStats,
  describeThresholds,
} from '../../lib/pnl/validationThresholds';
import type { CohortManifest, CohortType, WalletCohortEntry } from './build-cohort-manifest';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let cohortsArg = 'transfer_free,clob_only_closed,trader_strict,clean_large_traders';
let enginesArg = 'v11,v29';
let manifestPath = 'tmp/pnl_cohort_manifest.json';
let outputPath = 'tmp/unified_scorecard.json';
let limitPerCohort = 100;
let skipBuild = false;

for (const arg of args) {
  if (arg.startsWith('--cohorts=')) cohortsArg = arg.split('=')[1];
  if (arg.startsWith('--engines=')) enginesArg = arg.split('=')[1];
  if (arg.startsWith('--manifest=')) manifestPath = arg.split('=')[1];
  if (arg.startsWith('--output=')) outputPath = arg.split('=')[1];
  if (arg.startsWith('--limit=')) limitPerCohort = parseInt(arg.split('=')[1]);
  if (arg === '--skip-build') skipBuild = true;
}

const cohorts = cohortsArg.split(',') as CohortType[];
const engines = enginesArg.split(',');

// ============================================================================
// Types
// ============================================================================

interface WalletValidationResult {
  wallet: string;
  cohorts: CohortType[];
  dome_realized?: number;

  // V11 results
  v11_realized?: number;
  v11_error?: number;
  v11_passed?: boolean;
  v11_failure_reason?: string;

  // V29 results
  v29_realized?: number;
  v29_error?: number;
  v29_passed?: boolean;
  v29_failure_reason?: string;
}

interface EngineScorecard {
  engine: string;
  benchmark: string;
  metric_type: string;
  thresholds: string;
  overall: BatchStats;
  by_cohort: Record<CohortType, BatchStats>;
}

interface UnifiedScorecard {
  generated_at: string;
  config: {
    cohorts: CohortType[];
    engines: string[];
    manifest_path: string;
    limit_per_cohort: number;
  };
  summary: {
    best_engine_overall: string;
    best_engine_by_cohort: Record<CohortType, string>;
    production_recommendation: {
      cohort: CohortType;
      engine: string;
      pass_rate: number;
      rationale: string;
    };
  };
  engine_scorecards: EngineScorecard[];
  wallet_results: WalletValidationResult[];
}

// ============================================================================
// Engine Runners
// ============================================================================

async function runV11(wallet: string): Promise<{ realized: number; error?: string }> {
  try {
    const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
      includeSyntheticRedemptions: false,
      includeErc1155Transfers: false,
    });

    const result = computeWalletPnlFromEvents(wallet, events, { mode: 'ui_like' });
    return { realized: result.realizedPnl };
  } catch (err: any) {
    return { realized: 0, error: err.message };
  }
}

async function runV29(
  wallet: string,
  preload?: Awaited<ReturnType<typeof preloadV29Data>>
): Promise<{ realized: number; error?: string }> {
  try {
    let opts: any = { inventoryGuard: true };

    if (preload) {
      const events = preload.eventsByWallet.get(wallet) || [];
      opts.preload = {
        events,
        resolutionPrices: preload.resolutionPrices,
      };
    }

    const result = await calculateV29PnL(wallet, opts);
    return { realized: result.realizedPnl ?? 0 };
  } catch (err: any) {
    return { realized: 0, error: err.message };
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('UNIFIED SCORECARD - Engine Validation');
  console.log('='.repeat(80));
  console.log('');
  console.log('Config:');
  console.log(`  cohorts: ${cohorts.join(', ')}`);
  console.log(`  engines: ${engines.join(', ')}`);
  console.log(`  manifest: ${manifestPath}`);
  console.log(`  limit per cohort: ${limitPerCohort}`);
  console.log(`  thresholds: ${describeThresholds(DOME_THRESHOLDS)}`);
  console.log('');

  // ========================================================================
  // Step 1: Load or build manifest
  // ========================================================================
  console.log('Step 1: Loading cohort manifest...');

  let manifest: CohortManifest;

  if (!skipBuild || !fs.existsSync(manifestPath)) {
    console.log('  Building manifest (run with --skip-build to skip)...');
    const { execSync } = await import('child_process');
    execSync(`npx tsx scripts/pnl/build-cohort-manifest.ts --limit=500 --dome-only --output=${manifestPath}`, {
      stdio: 'inherit',
    });
  }

  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`  Loaded manifest with ${manifest.summary.total_wallets} wallets`);

  // ========================================================================
  // Step 2: Select wallets for each cohort
  // ========================================================================
  console.log('Step 2: Selecting wallets per cohort...');

  const selectedWallets = new Set<string>();
  const walletsByCohort: Record<CohortType, string[]> = {} as any;

  for (const cohort of cohorts) {
    const cohortWallets = manifest.cohort_lists[cohort] || [];
    // Filter to wallets with Dome benchmarks
    const withDome = cohortWallets.filter(w => {
      const entry = manifest.wallets.find(e => e.wallet === w);
      return entry?.dome_realized !== undefined;
    });

    walletsByCohort[cohort] = withDome.slice(0, limitPerCohort);
    for (const w of walletsByCohort[cohort]) {
      selectedWallets.add(w);
    }

    console.log(`  ${cohort}: ${walletsByCohort[cohort].length} wallets`);
  }

  const allWallets = Array.from(selectedWallets);
  console.log(`  Total unique wallets: ${allWallets.length}`);

  // ========================================================================
  // Step 3: Preload data for V29 (if needed)
  // ========================================================================
  let v29Preload: Awaited<ReturnType<typeof preloadV29Data>> | undefined;

  if (engines.includes('v29')) {
    console.log('Step 3: Preloading V29 data...');
    v29Preload = await preloadV29Data(allWallets);
    console.log('  Done');
  }

  // ========================================================================
  // Step 4: Run validation for each wallet
  // ========================================================================
  console.log('Step 4: Running engine validation...');

  const walletResults: WalletValidationResult[] = [];

  for (let i = 0; i < allWallets.length; i++) {
    const wallet = allWallets[i];
    const entry = manifest.wallets.find(e => e.wallet === wallet);
    if (!entry || entry.dome_realized === undefined) continue;

    process.stdout.write(`\r  [${i + 1}/${allWallets.length}] ${wallet.slice(0, 10)}...`);

    const result: WalletValidationResult = {
      wallet,
      cohorts: entry.cohorts,
      dome_realized: entry.dome_realized,
    };

    // Run V11
    if (engines.includes('v11')) {
      const v11 = await runV11(wallet);
      result.v11_realized = v11.realized;

      if (!v11.error) {
        const pass = isPass(entry.dome_realized, v11.realized, DOME_THRESHOLDS);
        result.v11_error = pass.absError;
        result.v11_passed = pass.passed;
        result.v11_failure_reason = pass.failureReason;
      } else {
        result.v11_failure_reason = `ERROR: ${v11.error}`;
      }
    }

    // Run V29
    if (engines.includes('v29')) {
      const v29 = await runV29(wallet, v29Preload);
      result.v29_realized = v29.realized;

      if (!v29.error) {
        const pass = isPass(entry.dome_realized, v29.realized, DOME_THRESHOLDS);
        result.v29_error = pass.absError;
        result.v29_passed = pass.passed;
        result.v29_failure_reason = pass.failureReason;
      } else {
        result.v29_failure_reason = `ERROR: ${v29.error}`;
      }
    }

    walletResults.push(result);
  }

  console.log('\n');

  // ========================================================================
  // Step 5: Calculate scorecards
  // ========================================================================
  console.log('Step 5: Calculating scorecards...');

  const engineScorecards: EngineScorecard[] = [];

  for (const engine of engines) {
    const engineResults = walletResults.map(r => ({
      wallet: r.wallet,
      cohorts: r.cohorts,
      benchmarkValue: r.dome_realized!,
      ourValue: engine === 'v11' ? r.v11_realized! : r.v29_realized!,
      passed: engine === 'v11' ? r.v11_passed! : r.v29_passed!,
      failureReason: engine === 'v11' ? r.v11_failure_reason : r.v29_failure_reason,
    })).filter(r => r.ourValue !== undefined);

    // Overall stats
    const overall = calculateBatchStats(engineResults, DOME_THRESHOLDS);

    // By cohort stats
    const byCohort: Record<CohortType, BatchStats> = {} as any;
    for (const cohort of cohorts) {
      const cohortResults = engineResults.filter(r => r.cohorts.includes(cohort));
      byCohort[cohort] = calculateBatchStats(cohortResults, DOME_THRESHOLDS);
    }

    engineScorecards.push({
      engine: engine.toUpperCase(),
      benchmark: 'Dome Realized',
      metric_type: 'realized',
      thresholds: describeThresholds(DOME_THRESHOLDS),
      overall,
      by_cohort: byCohort,
    });
  }

  // ========================================================================
  // Step 6: Determine best engine
  // ========================================================================
  console.log('Step 6: Determining best engine...');

  // Best overall
  let bestOverall = engines[0];
  let bestOverallRate = 0;
  for (const card of engineScorecards) {
    if (card.overall.passRate > bestOverallRate) {
      bestOverallRate = card.overall.passRate;
      bestOverall = card.engine.toLowerCase();
    }
  }

  // Best by cohort
  const bestByCohort: Record<CohortType, string> = {} as any;
  for (const cohort of cohorts) {
    let bestEngine = engines[0];
    let bestRate = 0;
    for (const card of engineScorecards) {
      const cohortStats = card.by_cohort[cohort];
      if (cohortStats && cohortStats.passRate > bestRate) {
        bestRate = cohortStats.passRate;
        bestEngine = card.engine.toLowerCase();
      }
    }
    bestByCohort[cohort] = bestEngine;
  }

  // Production recommendation
  // Find the cohort with highest pass rate that has >= 50 wallets
  let productionCohort: CohortType = 'trader_strict';
  let productionEngine = bestOverall;
  let productionRate = 0;
  let productionRationale = '';

  for (const cohort of cohorts) {
    for (const card of engineScorecards) {
      const stats = card.by_cohort[cohort];
      if (stats && stats.total >= 20 && stats.passRate > productionRate) {
        productionRate = stats.passRate;
        productionCohort = cohort;
        productionEngine = card.engine.toLowerCase();
        productionRationale = `${cohort} achieves ${(stats.passRate * 100).toFixed(1)}% pass rate with ${stats.total} wallets using ${card.engine}`;
      }
    }
  }

  // ========================================================================
  // Step 7: Build and save scorecard
  // ========================================================================
  console.log('Step 7: Saving scorecard...');

  const scorecard: UnifiedScorecard = {
    generated_at: new Date().toISOString(),
    config: {
      cohorts,
      engines,
      manifest_path: manifestPath,
      limit_per_cohort: limitPerCohort,
    },
    summary: {
      best_engine_overall: bestOverall,
      best_engine_by_cohort: bestByCohort,
      production_recommendation: {
        cohort: productionCohort,
        engine: productionEngine,
        pass_rate: productionRate,
        rationale: productionRationale,
      },
    },
    engine_scorecards: engineScorecards,
    wallet_results: walletResults,
  };

  fs.writeFileSync(outputPath, JSON.stringify(scorecard, null, 2));

  // ========================================================================
  // Step 8: Print summary
  // ========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('UNIFIED SCORECARD RESULTS');
  console.log('='.repeat(80));
  console.log('');

  for (const card of engineScorecards) {
    console.log(`${card.engine} vs ${card.benchmark}:`);
    console.log(`  Overall: ${card.overall.passed}/${card.overall.total} (${(card.overall.passRate * 100).toFixed(1)}%)`);
    console.log(`  By cohort:`);
    for (const cohort of cohorts) {
      const stats = card.by_cohort[cohort];
      if (stats && stats.total > 0) {
        console.log(`    ${cohort.padEnd(22)}: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%)`);
      }
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('PRODUCTION RECOMMENDATION');
  console.log('='.repeat(80));
  console.log('');
  console.log(`  Ship Cohort: ${scorecard.summary.production_recommendation.cohort}`);
  console.log(`  Use Engine: ${scorecard.summary.production_recommendation.engine}`);
  console.log(`  Pass Rate: ${(scorecard.summary.production_recommendation.pass_rate * 100).toFixed(1)}%`);
  console.log(`  Rationale: ${scorecard.summary.production_recommendation.rationale}`);
  console.log('');

  console.log(`Saved to ${outputPath}`);

  // Also generate markdown report
  const reportPath = outputPath.replace('.json', '.md').replace('tmp/', 'docs/reports/');
  generateMarkdownReport(scorecard, reportPath);
  console.log(`Report saved to ${reportPath}`);
}

// ============================================================================
// Markdown Report Generator
// ============================================================================

function generateMarkdownReport(scorecard: UnifiedScorecard, path: string) {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push(`# Unified PnL Scorecard - ${date}`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`**Best Engine Overall:** ${scorecard.summary.best_engine_overall.toUpperCase()}`);
  lines.push('');
  lines.push('### Production Recommendation');
  lines.push('');
  lines.push(`- **Ship Cohort:** ${scorecard.summary.production_recommendation.cohort}`);
  lines.push(`- **Use Engine:** ${scorecard.summary.production_recommendation.engine.toUpperCase()}`);
  lines.push(`- **Pass Rate:** ${(scorecard.summary.production_recommendation.pass_rate * 100).toFixed(1)}%`);
  lines.push(`- **Rationale:** ${scorecard.summary.production_recommendation.rationale}`);
  lines.push('');

  lines.push('## Engine Comparison');
  lines.push('');

  for (const card of scorecard.engine_scorecards) {
    lines.push(`### ${card.engine}`);
    lines.push('');
    lines.push(`**Benchmark:** ${card.benchmark}`);
    lines.push(`**Thresholds:** ${card.thresholds}`);
    lines.push('');
    lines.push(`**Overall:** ${card.overall.passed}/${card.overall.total} (${(card.overall.passRate * 100).toFixed(1)}%)`);
    lines.push('');
    lines.push('| Cohort | Passed | Total | Rate |');
    lines.push('|--------|--------|-------|------|');

    for (const [cohort, stats] of Object.entries(card.by_cohort)) {
      if (stats.total > 0) {
        lines.push(`| ${cohort} | ${stats.passed} | ${stats.total} | ${(stats.passRate * 100).toFixed(1)}% |`);
      }
    }
    lines.push('');
  }

  lines.push('## Cohort Definitions');
  lines.push('');
  lines.push('See [PNL_TAXONOMY.md](./PNL_TAXONOMY.md) for full definitions.');
  lines.push('');
  lines.push('| Cohort | Description |');
  lines.push('|--------|-------------|');
  lines.push('| transfer_free | No ERC1155 transfers |');
  lines.push('| clob_only | Only CLOB trades |');
  lines.push('| clob_only_closed | CLOB-only with all positions closed |');
  lines.push('| trader_strict | CLOB-only + transfer-free + no splits/merges |');
  lines.push('| clean_large_traders | trader_strict + |PnL| >= $200 |');
  lines.push('');

  lines.push('## Validation Thresholds');
  lines.push('');
  lines.push('| PnL Magnitude | Threshold | Type |');
  lines.push('|---------------|-----------|------|');
  lines.push('| |PnL| >= $200 | <= 6% | Percentage |');
  lines.push('| |PnL| < $200 | <= $10 | Absolute |');
  lines.push('');

  lines.push('## Configuration');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(scorecard.config, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('---');
  lines.push(`*Generated: ${scorecard.generated_at}*`);

  fs.writeFileSync(path, lines.join('\n'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
