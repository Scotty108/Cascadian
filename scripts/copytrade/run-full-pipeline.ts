/**
 * Copy-Trading Portfolio Pipeline Orchestrator
 *
 * Runs all 8 phases in sequence to generate an optimal copy-trading portfolio.
 *
 * Usage:
 *   npx tsx scripts/copytrade/run-full-pipeline.ts [--capital 1000] [--use-playwright]
 *
 * Phases:
 *   1. Build candidate universe (pm_unified_ledger_v6)
 *   2. Compute core metrics (V19s P&L)
 *   3. Compute copyability scores
 *   4. Classify strategies and risk profiles
 *   5. Shadow copy simulation (execution friction)
 *   6. Build diversified portfolio
 *   7. Playwright validation
 *   8. Final export (CSV, JSON, Report)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { buildCandidateUniverse } from './01-build-candidate-universe';
import { computeCoreMetrics } from './02-compute-core-metrics';
import { computeCopyability } from './03-compute-copyability';
import { classifyStrategies } from './04-classify-strategies';
import { runShadowSimulation } from './05-shadow-simulation';
import { buildPortfolio } from './06-build-portfolio';
import { validateWithPlaywright } from './07-playwright-validation';
import { exportPortfolio } from './08-export-portfolio';

async function runPipeline() {
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      COPY-TRADING PORTFOLIO OPTIMIZATION PIPELINE v2        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Pipeline Phases:');
  console.log('  1. Candidate Universe     │ Unbiased pull from ledger');
  console.log('  2. Core Metrics          │ V19s P&L calculation');
  console.log('  3. Copyability           │ Entry price, hold time analysis');
  console.log('  4. Strategy Classification│ Value, Momentum, Event-Driven');
  console.log('  5. Shadow Simulation      │ Execution friction modeling');
  console.log('  6. Portfolio Construction │ Capped tier allocation');
  console.log('  7. Playwright Validation  │ UI verification');
  console.log('  8. Final Export          │ CSV, JSON, Report\n');

  const phases: { name: string; fn: () => Promise<any> }[] = [
    { name: 'Phase 1: Candidate Universe', fn: buildCandidateUniverse },
    { name: 'Phase 2: Core Metrics', fn: computeCoreMetrics },
    { name: 'Phase 3: Copyability', fn: computeCopyability },
    { name: 'Phase 4: Strategy Classification', fn: classifyStrategies },
    { name: 'Phase 5: Shadow Simulation', fn: runShadowSimulation },
    { name: 'Phase 6: Portfolio Construction', fn: buildPortfolio },
    { name: 'Phase 7: Playwright Validation', fn: validateWithPlaywright },
    { name: 'Phase 8: Final Export', fn: exportPortfolio },
  ];

  const results: { phase: string; duration: number; success: boolean; error?: string }[] = [];

  for (const phase of phases) {
    console.log('\n' + '═'.repeat(60));
    console.log(`Starting ${phase.name}...`);
    console.log('═'.repeat(60) + '\n');

    const phaseStart = Date.now();

    try {
      await phase.fn();
      const duration = (Date.now() - phaseStart) / 1000;
      results.push({ phase: phase.name, duration, success: true });
      console.log(`\n✓ ${phase.name} completed in ${duration.toFixed(1)}s`);
    } catch (err) {
      const duration = (Date.now() - phaseStart) / 1000;
      const errorMsg = (err as Error).message;
      results.push({ phase: phase.name, duration, success: false, error: errorMsg });
      console.error(`\n✗ ${phase.name} failed: ${errorMsg}`);

      // Ask if we should continue
      console.log('\n⚠️ Phase failed. Pipeline halted.');
      break;
    }
  }

  // Final summary
  const totalDuration = (Date.now() - startTime) / 1000;

  console.log('\n' + '═'.repeat(60));
  console.log('PIPELINE SUMMARY');
  console.log('═'.repeat(60) + '\n');

  console.log('Phase Results:');
  for (const r of results) {
    const status = r.success ? '✓' : '✗';
    console.log(`  ${status} ${r.phase.padEnd(35)} ${r.duration.toFixed(1).padStart(6)}s`);
    if (r.error) {
      console.log(`      Error: ${r.error.slice(0, 50)}...`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\nCompleted: ${successCount}/${phases.length} phases`);
  console.log(`Total time: ${totalDuration.toFixed(1)}s`);

  if (successCount === phases.length) {
    console.log('\n✓ Pipeline completed successfully!');
    console.log('\nOutput files:');
    const dateStr = new Date().toISOString().slice(0, 10);
    console.log(`  - exports/copytrade/optimal_portfolio_${dateStr}.csv`);
    console.log(`  - exports/copytrade/watchlist_${dateStr}.json`);
    console.log(`  - docs/reports/COPYTRADE_PORTFOLIO_VALIDATION_${dateStr}.md`);
  } else {
    console.log('\n✗ Pipeline incomplete. Check errors above.');
  }
}

// Run if executed directly
if (require.main === module) {
  runPipeline().catch(err => {
    console.error('Pipeline failed:', err);
    process.exit(1);
  });
}
