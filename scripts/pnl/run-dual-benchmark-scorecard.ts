#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * RUN DUAL BENCHMARK SCORECARD - Combined Dome + UI Validation
 * ============================================================================
 *
 * Merges realized (Dome) and total (UI) validation results into a single
 * scorecard that answers:
 *
 * 1. Which engine is best for realized truth (Dome)?
 * 2. Which engine is best for UI total parity (UI)?
 * 3. Which engine should we use for copy-trade leaderboard?
 *
 * Inputs:
 *   tmp/realized_vs_dome_multi.json (from validate-realized-vs-dome-multi.ts)
 *   tmp/total_vs_ui_multi.json (from validate-total-vs-ui-multi.ts)
 *
 * Output:
 *   tmp/dual_scorecard.json
 *   docs/reports/DUAL_BENCHMARK_SCORECARD_YYYY_MM_DD.md
 *
 * Usage:
 *   npx tsx scripts/pnl/run-dual-benchmark-scorecard.ts
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { EngineName } from '../../lib/pnl/engines/engineRegistry';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let realizedInput = 'tmp/realized_vs_dome_multi.json';
let totalInput = 'tmp/total_vs_ui_multi.json';
let output = 'tmp/dual_scorecard.json';
let reportOutput = '';

for (const arg of args) {
  if (arg.startsWith('--realized=')) realizedInput = arg.split('=')[1];
  if (arg.startsWith('--total=')) totalInput = arg.split('=')[1];
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
  if (arg.startsWith('--report=')) reportOutput = arg.split('=')[1];
}

// Generate report filename if not specified
if (!reportOutput) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
  reportOutput = `docs/reports/DUAL_BENCHMARK_SCORECARD_${date}.md`;
}

// ============================================================================
// Types
// ============================================================================

interface EngineSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  medianPctError: number;
  medianAbsError: number;
  avgComputeTimeMs: number;
}

interface RealizedInput {
  metadata: {
    total_wallets: number;
    thresholds: { pct: number; abs: number };
  };
  summary: {
    by_engine: Record<EngineName, EngineSummary>;
    bestEngine: EngineName | null;
  };
  results: Array<{
    wallet_address: string;
    dome_realized: number;
    engines: Record<EngineName, {
      passed: boolean;
      pctError: number;
      absError: number;
      failureReason?: string;
    }>;
  }>;
}

interface TotalInput {
  metadata: {
    total_wallets: number;
    wallets_with_ui_pnl: number;
    thresholds: { pct: number; abs: number };
  };
  summary: {
    by_engine: Record<EngineName, EngineSummary>;
    bestEngine: EngineName | null;
  };
  results: Array<{
    wallet_address: string;
    ui_total_pnl: number;
    engines: Record<EngineName, {
      passed: boolean;
      pctError: number;
      absError: number;
      failureReason?: string;
    }>;
  }>;
}

interface DualScorecard {
  metadata: {
    generated_at: string;
    realized_input: string;
    total_input: string;
  };
  realized_benchmark: {
    benchmark: 'Dome';
    metric: 'Realized PnL';
    wallets_tested: number;
    by_engine: Record<EngineName, EngineSummary>;
    best_engine: EngineName | null;
  };
  total_benchmark: {
    benchmark: 'UI';
    metric: 'Total PnL';
    wallets_tested: number;
    by_engine: Record<EngineName, EngineSummary>;
    best_engine: EngineName | null;
  };
  comparison: {
    engine: EngineName;
    dome_pass_rate: number;
    ui_pass_rate: number;
    combined_score: number;
    recommendation: string;
  }[];
  recommendations: {
    for_copy_trade: EngineName;
    for_ui_display: EngineName;
    rationale: string[];
  };
  failure_analysis: {
    sign_disagreements: Record<EngineName, number>;
    large_pct_errors: Record<EngineName, number>;
    common_failure_reasons: Record<EngineName, Record<string, number>>;
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('DUAL BENCHMARK SCORECARD');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Realized input: ${realizedInput}`);
  console.log(`Total input: ${totalInput}`);
  console.log(`Output: ${output}`);
  console.log(`Report: ${reportOutput}`);
  console.log('');

  // Check for input files
  const hasRealized = fs.existsSync(realizedInput);
  const hasTotal = fs.existsSync(totalInput);

  if (!hasRealized && !hasTotal) {
    console.error('Neither input file found. Run validation scripts first.');
    process.exit(1);
  }

  let realizedData: RealizedInput | null = null;
  let totalData: TotalInput | null = null;

  if (hasRealized) {
    realizedData = JSON.parse(fs.readFileSync(realizedInput, 'utf-8'));
    console.log(`Loaded realized validation: ${realizedData.metadata.total_wallets} wallets`);
  } else {
    console.log('Realized validation not found - will skip Dome benchmark');
  }

  if (hasTotal) {
    totalData = JSON.parse(fs.readFileSync(totalInput, 'utf-8'));
    console.log(`Loaded total validation: ${totalData.metadata.wallets_with_ui_pnl} wallets`);
  } else {
    console.log('Total validation not found - will skip UI benchmark');
  }

  console.log('');

  const engineNames: EngineName[] = ['V11', 'V29', 'V23C'];

  // Build scorecard
  const scorecard: DualScorecard = {
    metadata: {
      generated_at: new Date().toISOString(),
      realized_input: realizedInput,
      total_input: totalInput,
    },
    realized_benchmark: {
      benchmark: 'Dome',
      metric: 'Realized PnL',
      wallets_tested: realizedData?.metadata.total_wallets || 0,
      by_engine: realizedData?.summary.by_engine || {} as any,
      best_engine: realizedData?.summary.bestEngine || null,
    },
    total_benchmark: {
      benchmark: 'UI',
      metric: 'Total PnL',
      wallets_tested: totalData?.metadata.wallets_with_ui_pnl || 0,
      by_engine: totalData?.summary.by_engine || {} as any,
      best_engine: totalData?.summary.bestEngine || null,
    },
    comparison: [],
    recommendations: {
      for_copy_trade: 'V11',
      for_ui_display: 'V23C',
      rationale: [],
    },
    failure_analysis: {
      sign_disagreements: { V11: 0, V29: 0, V23C: 0 },
      large_pct_errors: { V11: 0, V29: 0, V23C: 0 },
      common_failure_reasons: { V11: {}, V29: {}, V23C: {} },
    },
  };

  // Build comparison
  for (const engine of engineNames) {
    const domePassRate = realizedData?.summary.by_engine[engine]?.passRate || 0;
    const uiPassRate = totalData?.summary.by_engine[engine]?.passRate || 0;

    // Combined score: weighted average (60% Dome for copy-trade, 40% UI)
    const combinedScore = domePassRate * 0.6 + uiPassRate * 0.4;

    let recommendation = '';
    if (domePassRate >= 0.9 && uiPassRate >= 0.8) {
      recommendation = 'Excellent - suitable for both copy-trade and UI';
    } else if (domePassRate >= 0.8) {
      recommendation = 'Good for copy-trade (realized accuracy)';
    } else if (uiPassRate >= 0.8) {
      recommendation = 'Good for UI display (total parity)';
    } else {
      recommendation = 'Needs improvement';
    }

    scorecard.comparison.push({
      engine,
      dome_pass_rate: domePassRate,
      ui_pass_rate: uiPassRate,
      combined_score: combinedScore,
      recommendation,
    });
  }

  // Sort comparison by combined score
  scorecard.comparison.sort((a, b) => b.combined_score - a.combined_score);

  // Analyze failures
  if (realizedData) {
    for (const result of realizedData.results) {
      for (const engine of engineNames) {
        const e = result.engines[engine];
        if (!e.passed) {
          if (e.failureReason === 'SIGN_DISAGREEMENT') {
            scorecard.failure_analysis.sign_disagreements[engine]++;
          }
          if (e.pctError > 20) {
            scorecard.failure_analysis.large_pct_errors[engine]++;
          }
          if (e.failureReason) {
            const bucket = e.failureReason.startsWith('PCT_ERROR') ? 'PCT_ERROR' :
                           e.failureReason.startsWith('ABS_ERROR') ? 'ABS_ERROR' :
                           e.failureReason;
            scorecard.failure_analysis.common_failure_reasons[engine][bucket] =
              (scorecard.failure_analysis.common_failure_reasons[engine][bucket] || 0) + 1;
          }
        }
      }
    }
  }

  // Generate recommendations
  const bestForCopyTrade = scorecard.comparison[0].engine;
  const bestForUI = totalData?.summary.bestEngine || scorecard.comparison[0].engine;

  scorecard.recommendations.for_copy_trade = bestForCopyTrade;
  scorecard.recommendations.for_ui_display = bestForUI;
  scorecard.recommendations.rationale = [
    `${bestForCopyTrade} has the highest combined score (${(scorecard.comparison[0].combined_score * 100).toFixed(1)}%)`,
  ];

  if (realizedData?.summary.bestEngine) {
    scorecard.recommendations.rationale.push(
      `${realizedData.summary.bestEngine} is best for realized accuracy vs Dome (${(realizedData.summary.by_engine[realizedData.summary.bestEngine].passRate * 100).toFixed(1)}%)`
    );
  }

  if (totalData?.summary.bestEngine) {
    scorecard.recommendations.rationale.push(
      `${totalData.summary.bestEngine} is best for UI total parity (${(totalData.summary.by_engine[totalData.summary.bestEngine].passRate * 100).toFixed(1)}%)`
    );
  }

  // Write JSON output
  fs.writeFileSync(output, JSON.stringify(scorecard, null, 2));

  // Generate markdown report
  const report = generateMarkdownReport(scorecard);

  // Ensure docs/reports directory exists
  const reportDir = reportOutput.substring(0, reportOutput.lastIndexOf('/'));
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(reportOutput, report);

  // Print summary
  console.log('='.repeat(80));
  console.log('DUAL BENCHMARK SCORECARD');
  console.log('='.repeat(80));
  console.log('');

  console.log('REALIZED PNL vs DOME:');
  if (realizedData) {
    for (const engine of engineNames) {
      const s = realizedData.summary.by_engine[engine];
      const best = engine === realizedData.summary.bestEngine ? ' ***' : '';
      console.log(`  ${engine}: ${(s.passRate * 100).toFixed(1)}% pass rate${best}`);
    }
  } else {
    console.log('  (no data)');
  }
  console.log('');

  console.log('TOTAL PNL vs UI:');
  if (totalData) {
    for (const engine of engineNames) {
      const s = totalData.summary.by_engine[engine];
      const best = engine === totalData.summary.bestEngine ? ' ***' : '';
      console.log(`  ${engine}: ${(s.passRate * 100).toFixed(1)}% pass rate${best}`);
    }
  } else {
    console.log('  (no data)');
  }
  console.log('');

  console.log('COMBINED RANKING:');
  for (let i = 0; i < scorecard.comparison.length; i++) {
    const c = scorecard.comparison[i];
    console.log(`  ${i + 1}. ${c.engine}: ${(c.combined_score * 100).toFixed(1)}% combined`);
    console.log(`     Dome: ${(c.dome_pass_rate * 100).toFixed(1)}% | UI: ${(c.ui_pass_rate * 100).toFixed(1)}%`);
    console.log(`     ${c.recommendation}`);
  }
  console.log('');

  console.log('RECOMMENDATIONS:');
  for (const r of scorecard.recommendations.rationale) {
    console.log(`  - ${r}`);
  }
  console.log('');

  console.log(`JSON output: ${output}`);
  console.log(`Markdown report: ${reportOutput}`);
  console.log('');
}

function generateMarkdownReport(scorecard: DualScorecard): string {
  const lines: string[] = [];

  lines.push('# Dual Benchmark Scorecard');
  lines.push('');
  lines.push(`Generated: ${scorecard.metadata.generated_at}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('This report compares V11, V29, and V23C PnL engines against two benchmarks:');
  lines.push('1. **Dome** - Ground truth for **realized PnL**');
  lines.push('2. **UI** - Ground truth for **total PnL** (realized + unrealized)');
  lines.push('');

  lines.push('## Pass Rates');
  lines.push('');
  lines.push('| Engine | Dome (Realized) | UI (Total) | Combined* |');
  lines.push('|--------|-----------------|------------|-----------|');

  for (const c of scorecard.comparison) {
    lines.push(`| ${c.engine} | ${(c.dome_pass_rate * 100).toFixed(1)}% | ${(c.ui_pass_rate * 100).toFixed(1)}% | ${(c.combined_score * 100).toFixed(1)}% |`);
  }

  lines.push('');
  lines.push('*Combined = 60% Dome + 40% UI (weighted for copy-trade use case)');
  lines.push('');

  lines.push('## Detailed Results');
  lines.push('');

  lines.push('### Realized PnL vs Dome');
  lines.push('');
  if (scorecard.realized_benchmark.wallets_tested > 0) {
    lines.push(`Wallets tested: ${scorecard.realized_benchmark.wallets_tested}`);
    lines.push(`Best engine: **${scorecard.realized_benchmark.best_engine}**`);
    lines.push('');
    lines.push('| Engine | Pass Rate | Median % Error | Median $ Error |');
    lines.push('|--------|-----------|----------------|----------------|');
    for (const engine of ['V11', 'V29', 'V23C'] as EngineName[]) {
      const s = scorecard.realized_benchmark.by_engine[engine];
      if (s) {
        lines.push(`| ${engine} | ${(s.passRate * 100).toFixed(1)}% | ${s.medianPctError.toFixed(2)}% | $${s.medianAbsError.toFixed(2)} |`);
      }
    }
  } else {
    lines.push('No realized validation data available.');
  }
  lines.push('');

  lines.push('### Total PnL vs UI');
  lines.push('');
  if (scorecard.total_benchmark.wallets_tested > 0) {
    lines.push(`Wallets tested: ${scorecard.total_benchmark.wallets_tested}`);
    lines.push(`Best engine: **${scorecard.total_benchmark.best_engine}**`);
    lines.push('');
    lines.push('| Engine | Pass Rate | Median % Error | Median $ Error |');
    lines.push('|--------|-----------|----------------|----------------|');
    for (const engine of ['V11', 'V29', 'V23C'] as EngineName[]) {
      const s = scorecard.total_benchmark.by_engine[engine];
      if (s) {
        lines.push(`| ${engine} | ${(s.passRate * 100).toFixed(1)}% | ${s.medianPctError.toFixed(2)}% | $${s.medianAbsError.toFixed(2)} |`);
      }
    }
  } else {
    lines.push('No total validation data available.');
  }
  lines.push('');

  lines.push('## Failure Analysis');
  lines.push('');
  lines.push('### Sign Disagreements');
  lines.push('');
  for (const engine of ['V11', 'V29', 'V23C'] as EngineName[]) {
    lines.push(`- ${engine}: ${scorecard.failure_analysis.sign_disagreements[engine]}`);
  }
  lines.push('');

  lines.push('### Large Percentage Errors (>20%)');
  lines.push('');
  for (const engine of ['V11', 'V29', 'V23C'] as EngineName[]) {
    lines.push(`- ${engine}: ${scorecard.failure_analysis.large_pct_errors[engine]}`);
  }
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  lines.push(`**For Copy-Trade Leaderboard:** ${scorecard.recommendations.for_copy_trade}`);
  lines.push(`**For UI Display:** ${scorecard.recommendations.for_ui_display}`);
  lines.push('');
  lines.push('### Rationale');
  lines.push('');
  for (const r of scorecard.recommendations.rationale) {
    lines.push(`- ${r}`);
  }
  lines.push('');

  lines.push('## Next Steps');
  lines.push('');
  lines.push('1. Use the recommended engine for the copy-trade leaderboard');
  lines.push('2. Investigate sign disagreements for data quality issues');
  lines.push('3. For large errors, check for CTF splits/merges or transfers');
  lines.push('');

  return lines.join('\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
