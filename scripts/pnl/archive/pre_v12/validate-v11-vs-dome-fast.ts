#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE V11 ENGINE VS DOME - FAST PATH
 * ============================================================================
 *
 * Uses the V11 engine (already optimized for CLOB-only realized) against
 * existing Dome data. This avoids slow view queries.
 *
 * Input:
 *   tmp/dome_realized_500_2025_12_07.json (existing Dome data)
 *
 * Output:
 *   tmp/v11_vs_dome_fast.json
 *   docs/pnl/V11_VS_DOME_FAST_VALIDATION.md
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-v11-vs-dome-fast.ts
 *   npx tsx scripts/pnl/validate-v11-vs-dome-fast.ts --limit=50
 *
 * Terminal: Claude 2 (Parallel Dome Validation Track)
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getEngineRegistry, EngineName } from '../../lib/pnl/engines/engineRegistry';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let limit = 500;
let engines: EngineName[] = ['V11'];

for (const arg of args) {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]);
  if (arg === '--all-engines') engines = ['V11', 'V29', 'V23C'];
}

// ============================================================================
// Types
// ============================================================================

interface DomeWallet {
  wallet: string;
  realizedPnl: number | null;
  confidence: string;
  isPlaceholder: boolean;
}

interface ValidationResult {
  wallet: string;
  dome_realized: number;
  dome_confidence: string;
  engine_results: Record<EngineName, {
    realized: number;
    delta: number;
    pct_error: number;
    abs_error: number;
    passed_5pct: boolean;
    passed_10usd: boolean;
    compute_ms: number;
  }>;
  best_engine: EngineName | null;
}

// ============================================================================
// Load Dome Data
// ============================================================================

function loadDomeData(maxWallets: number): DomeWallet[] {
  const files = [
    'tmp/dome_realized_500_2025_12_07.json',
    'tmp/dome_realized_omega_top50_2025_12_07.json',
  ];

  const wallets: DomeWallet[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (fs.existsSync(file)) {
      console.log(`Loading ${file}...`);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const w of data.wallets || []) {
        const lower = w.wallet.toLowerCase();
        if (!seen.has(lower) && !w.isPlaceholder && w.realizedPnl !== null && w.confidence === 'high') {
          seen.add(lower);
          wallets.push({
            wallet: lower,
            realizedPnl: w.realizedPnl,
            confidence: w.confidence,
            isPlaceholder: w.isPlaceholder,
          });
        }
        if (wallets.length >= maxWallets) break;
      }
    }
    if (wallets.length >= maxWallets) break;
  }

  console.log(`Loaded ${wallets.length} wallets with high-confidence Dome realized PnL`);
  return wallets;
}

// ============================================================================
// Validate
// ============================================================================

async function validate(
  domeWallets: DomeWallet[],
  engineNames: EngineName[]
): Promise<ValidationResult[]> {
  console.log(`\nValidating ${domeWallets.length} wallets against engines: ${engineNames.join(', ')}...`);

  const registry = getEngineRegistry();
  const results: ValidationResult[] = [];

  for (let i = 0; i < domeWallets.length; i++) {
    const dome = domeWallets[i];
    const domeRealized = dome.realizedPnl!;

    process.stdout.write(`\r  Progress: ${i + 1}/${domeWallets.length} - ${dome.wallet.slice(0, 10)}...`);

    const engineResults: ValidationResult['engine_results'] = {} as any;
    let bestEngine: EngineName | null = null;
    let bestError = Infinity;

    for (const engineName of engineNames) {
      const start = Date.now();
      try {
        const pnlResult = await registry.computeFull(engineName, dome.wallet);
        const realized = pnlResult.realizedPnl;
        const delta = realized - domeRealized;
        const absError = Math.abs(delta);
        const pctError = Math.abs(domeRealized) > 1 ? (absError / Math.abs(domeRealized)) * 100 : (absError > 1 ? 100 : 0);

        engineResults[engineName] = {
          realized,
          delta,
          pct_error: pctError,
          abs_error: absError,
          passed_5pct: pctError < 5 || absError < 5,
          passed_10usd: absError < 10,
          compute_ms: Date.now() - start,
        };

        if (absError < bestError) {
          bestError = absError;
          bestEngine = engineName;
        }
      } catch (err: any) {
        engineResults[engineName] = {
          realized: 0,
          delta: -domeRealized,
          pct_error: 100,
          abs_error: Math.abs(domeRealized),
          passed_5pct: false,
          passed_10usd: false,
          compute_ms: Date.now() - start,
        };
      }
    }

    results.push({
      wallet: dome.wallet,
      dome_realized: domeRealized,
      dome_confidence: dome.confidence,
      engine_results: engineResults,
      best_engine: bestEngine,
    });
  }

  console.log('\n');
  return results;
}

// ============================================================================
// Generate Report
// ============================================================================

function generateReport(results: ValidationResult[], engineNames: EngineName[]): string {
  const now = new Date().toISOString();

  const engineStats: Record<EngineName, {
    pass5pct: number;
    pass10usd: number;
    avgPctError: number;
    avgAbsError: number;
    avgComputeMs: number;
  }> = {} as any;

  for (const engine of engineNames) {
    const engineResults = results.map(r => r.engine_results[engine]).filter(Boolean);
    engineStats[engine] = {
      pass5pct: engineResults.filter(r => r.passed_5pct).length,
      pass10usd: engineResults.filter(r => r.passed_10usd).length,
      avgPctError: engineResults.reduce((s, r) => s + r.pct_error, 0) / engineResults.length,
      avgAbsError: engineResults.reduce((s, r) => s + r.abs_error, 0) / engineResults.length,
      avgComputeMs: engineResults.reduce((s, r) => s + r.compute_ms, 0) / engineResults.length,
    };
  }

  // Find best engine
  let bestEngine: EngineName | null = null;
  let bestPassRate = 0;
  for (const [engine, stats] of Object.entries(engineStats)) {
    const passRate = stats.pass5pct / results.length;
    if (passRate > bestPassRate) {
      bestPassRate = passRate;
      bestEngine = engine as EngineName;
    }
  }

  // Worst outliers for best engine
  const worstOutliers = bestEngine ? results
    .filter(r => r.engine_results[bestEngine!] && !r.engine_results[bestEngine!].passed_10usd)
    .sort((a, b) => b.engine_results[bestEngine!].abs_error - a.engine_results[bestEngine!].abs_error)
    .slice(0, 20)
    : [];

  return `# V11 vs Dome Realized PnL Validation (Fast Path)

**Generated:** ${now}

## Summary

| Engine | Pass Rate (5%) | Pass Rate ($10) | Avg % Error | Avg $ Error | Avg Compute Time |
|--------|----------------|-----------------|-------------|-------------|------------------|
${engineNames.map(e => {
  const s = engineStats[e];
  const best = e === bestEngine ? ' **BEST**' : '';
  return `| ${e}${best} | ${(s.pass5pct / results.length * 100).toFixed(1)}% | ${(s.pass10usd / results.length * 100).toFixed(1)}% | ${s.avgPctError.toFixed(2)}% | $${s.avgAbsError.toFixed(2)} | ${s.avgComputeMs.toFixed(0)}ms |`;
}).join('\n')}

## Key Metrics

- **Total Wallets Validated:** ${results.length}
- **Best Engine:** ${bestEngine ?? 'N/A'} (${(bestPassRate * 100).toFixed(1)}% pass rate at 5% threshold)

## Interpretation

${bestPassRate > 0.8 ?
  '**STRONG ALIGNMENT:** >80% of wallets match Dome realized PnL within 5%. This validates our realized calculation methodology.' :
  bestPassRate > 0.6 ?
  '**MODERATE ALIGNMENT:** 60-80% match rate. Some discrepancies exist but core calculation appears sound.' :
  '**WEAK ALIGNMENT:** <60% match rate. Significant investigation needed.'}

## Top 20 Worst Outliers (${bestEngine ?? 'V11'})

| Wallet | Dome | Ours | Delta | % Error |
|--------|------|------|-------|---------|
${worstOutliers.map(r => {
  const e = r.engine_results[bestEngine ?? 'V11'];
  return `| \`${r.wallet.slice(0, 10)}...\` | $${r.dome_realized.toFixed(2)} | $${e.realized.toFixed(2)} | $${e.delta.toFixed(2)} | ${e.pct_error.toFixed(1)}% |`;
}).join('\n')}

## Methodology

- **Engine:** V11 (CLOB-only, resolution-aware)
- **Benchmark:** Dome API realized PnL (granularity=all, high confidence)
- **Pass Criteria:** Within 5% OR within $5 absolute

## Conclusion

${bestPassRate > 0.8 ?
  'Realized PnL calculation is validated against Dome. Any UI mismatches are due to unrealized valuation or UI-specific accounting.' :
  'Further investigation needed. Check outliers for patterns.'}
`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('VALIDATE V11 VS DOME - FAST PATH');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Limit: ${limit} wallets`);
  console.log(`Engines: ${engines.join(', ')}`);
  console.log('');

  // Step 1: Load Dome data
  const domeWallets = loadDomeData(limit);

  if (domeWallets.length === 0) {
    console.error('No Dome data found.');
    process.exit(1);
  }

  // Step 2: Validate
  const results = await validate(domeWallets, engines);

  // Step 3: Calculate summary
  const v11Results = results.map(r => r.engine_results['V11']).filter(Boolean);
  const pass5pct = v11Results.filter(r => r.passed_5pct).length;
  const pass10usd = v11Results.filter(r => r.passed_10usd).length;

  // Step 4: Write outputs
  const outputJson = 'tmp/v11_vs_dome_fast.json';
  const outputMd = 'docs/pnl/V11_VS_DOME_FAST_VALIDATION.md';

  if (!fs.existsSync('docs/pnl')) fs.mkdirSync('docs/pnl', { recursive: true });

  fs.writeFileSync(outputJson, JSON.stringify({
    metadata: {
      generated_at: new Date().toISOString(),
      total_wallets: results.length,
      engines,
    },
    results,
  }, null, 2));

  const report = generateReport(results, engines);
  fs.writeFileSync(outputMd, report);

  // Print summary
  console.log('='.repeat(80));
  console.log('SUMMARY (V11)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Total wallets: ${results.length}`);
  console.log('');
  console.log('Pass Rates:');
  console.log(`  Within 5%:  ${(pass5pct / results.length * 100).toFixed(1)}%`);
  console.log(`  Within $10: ${(pass10usd / results.length * 100).toFixed(1)}%`);
  console.log('');
  console.log(`Output JSON: ${outputJson}`);
  console.log(`Output Report: ${outputMd}`);
  console.log('');

  if (pass5pct / results.length > 0.8) {
    console.log('✅ STRONG ALIGNMENT: >80% match rate');
  } else if (pass5pct / results.length > 0.6) {
    console.log('⚠️  MODERATE ALIGNMENT: 60-80% match rate');
  } else {
    console.log('❌ WEAK ALIGNMENT: <60% match rate');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
