/**
 * Test V18 Rounding Regression
 *
 * Tests that V18.1 with per-position rounding improves accuracy
 * for known CLOB-only wallets compared to the previous implementation.
 *
 * Uses benchmark data from data/v18-benchmark-report.json
 */

import { createV18Engine } from '../../lib/pnl/uiActivityEngineV18';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: {
    username: string;
    pnl: number;
    volume: number;
  };
  v18: {
    total_pnl: number;
    volume_traded: number;
  };
}

interface Report {
  results: BenchmarkResult[];
}

async function main() {
  console.log('='.repeat(80));
  console.log('V18.1 ROUNDING REGRESSION TEST');
  console.log('='.repeat(80));

  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found. Run benchmark-v18-with-playwright.ts first.');
    return;
  }

  const report: Report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const results = report.results.filter((r) => r.ui.username !== 'Anon');

  console.log(`Testing ${results.length} wallets from benchmark report\n`);

  const engine = createV18Engine();

  let passCount = 0;
  let warnCount = 0;
  let totalErrorPct = 0;
  const errors: number[] = [];

  console.log('Wallet           | Username     | UI PnL       | V18.1 Total  | Error $    | Error %  | Status');
  console.log('-'.repeat(100));

  for (const benchmark of results) {
    const result = await engine.compute(benchmark.wallet);
    const error = result.total_pnl - benchmark.ui.pnl;
    const errorPct = benchmark.ui.pnl !== 0 ? Math.abs(error) / Math.abs(benchmark.ui.pnl) * 100 : 0;

    totalErrorPct += errorPct;
    errors.push(errorPct);

    // Consider ≤1% error as PASS, ≤5% as WARN
    const status = errorPct <= 1.0 ? 'PASS' : errorPct <= 5.0 ? 'WARN' : 'FAIL';
    if (status === 'PASS') passCount++;
    if (status === 'WARN') warnCount++;

    const statusIcon = status === 'PASS' ? '✓' : status === 'WARN' ? '~' : '✗';

    console.log(
      `${benchmark.wallet.substring(0, 14)}... | ` +
        `${benchmark.ui.username.substring(0, 12).padEnd(12)} | ` +
        `$${benchmark.ui.pnl.toFixed(2).padStart(10)} | ` +
        `$${result.total_pnl.toFixed(2).padStart(10)} | ` +
        `$${error.toFixed(2).padStart(8)} | ` +
        `${errorPct.toFixed(2).padStart(6)}% | ` +
        `${statusIcon} ${status}`
    );
  }

  const tested = results.length;
  const avgError = tested > 0 ? totalErrorPct / tested : 0;
  const medianError = errors.length > 0 ? errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)] : 0;

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Tested:       ${tested} wallets`);
  console.log(`Passed:       ${passCount}/${tested} (≤1% error)`);
  console.log(`Warnings:     ${warnCount}/${tested} (1-5% error)`);
  console.log(`Failed:       ${tested - passCount - warnCount}/${tested} (>5% error)`);
  console.log(`Avg Error:    ${avgError.toFixed(2)}%`);
  console.log(`Median Error: ${medianError.toFixed(2)}%`);

  if (passCount >= tested * 0.8) {
    console.log('\n✓ REGRESSION TEST PASSED - V18.1 rounding is working correctly');
  } else if (passCount >= tested * 0.6) {
    console.log('\n~ REGRESSION TEST WARNING - Most wallets pass, remaining are likely mixed CTF+CLOB');
  } else {
    console.log('\n✗ REGRESSION TEST FAILED - Review rounding implementation');
  }
}

main().catch(console.error);
