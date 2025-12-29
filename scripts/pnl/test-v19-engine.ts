/**
 * Test V19 Engine against benchmark wallets
 *
 * Validates:
 * 1. V19 PnL matches V18 for CLOB-only wallets
 * 2. V19 provides metrics (omega, sharpe, sortino, win_rate)
 * 3. Per-category breakdown works correctly
 */

import { createV19Engine, calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';
import * as fs from 'fs';

const REPORT_FILE = 'data/v18-benchmark-report.json';
const CLASSIFICATION_FILE = 'data/wallet-classification-report.json';

interface BenchmarkResult {
  wallet: string;
  ui: { pnl: number; username: string };
  v18: { total_pnl: number };
  total_pnl_error_pct: number;
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

async function main() {
  console.log('='.repeat(120));
  console.log('V19 ENGINE TEST');
  console.log('='.repeat(120));
  console.log('');
  console.log('Source: pm_unified_ledger_v6 (CLOB only, mapped trades only)');
  console.log('Formula: total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)');
  console.log('');

  // Load benchmark data
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No benchmark report found at ' + REPORT_FILE);
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
  const benchmarks: Map<string, BenchmarkResult> = new Map();
  for (const r of report.results) {
    benchmarks.set(r.wallet.toLowerCase(), r);
  }

  // Load classification
  let walletClasses = new Map<string, string>();
  if (fs.existsSync(CLASSIFICATION_FILE)) {
    const classification = JSON.parse(fs.readFileSync(CLASSIFICATION_FILE, 'utf-8'));
    for (const w of classification.classifications || []) {
      walletClasses.set(w.wallet.toLowerCase(), w.class);
    }
  }

  console.log(`Loaded ${benchmarks.size} benchmark wallets.`);
  console.log('');

  // Test quick PnL function first
  console.log('-'.repeat(120));
  console.log('QUICK PNL TEST (calculateV19PnL)');
  console.log('-'.repeat(120));
  console.log('');
  console.log('Username       | Class      | UI PnL      | V18         | V19         | V19 Err | Pos | Res');
  console.log('-'.repeat(100));

  const quickResults: {
    wallet: string;
    username: string;
    walletClass: string;
    ui: number;
    v18: number;
    v19: number;
    v19Err: number;
    positions: number;
    resolved: number;
  }[] = [];

  for (const [wallet, benchmark] of benchmarks) {
    const uiPnl = benchmark.ui?.pnl || 0;
    const v18Pnl = benchmark.v18?.total_pnl || 0;
    const username = benchmark.ui?.username || 'Unknown';
    const walletClass = walletClasses.get(wallet) || 'unknown';

    const v19 = await calculateV19PnL(wallet);

    const result = {
      wallet,
      username,
      walletClass,
      ui: uiPnl,
      v18: v18Pnl,
      v19: v19.total_pnl,
      v19Err: errorPct(v19.total_pnl, uiPnl),
      positions: v19.positions,
      resolved: v19.resolved,
    };

    quickResults.push(result);

    console.log(
      `${result.username.substring(0, 14).padEnd(14)} | ` +
        `${result.walletClass.substring(0, 10).padEnd(10)} | ` +
        `$${result.ui.toFixed(2).padStart(9)} | ` +
        `$${result.v18.toFixed(2).padStart(9)} | ` +
        `$${result.v19.toFixed(2).padStart(9)} | ` +
        `${result.v19Err.toFixed(1).padStart(5)}% | ` +
        `${result.positions.toString().padStart(3)} | ` +
        `${result.resolved.toString().padStart(3)}`
    );
  }

  // Summary
  const v19Errors = quickResults.map((r) => r.v19Err);
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const passCount = (arr: number[], threshold: number) => arr.filter((e) => e <= threshold).length;

  console.log('');
  console.log('-'.repeat(100));
  console.log(`V19 Quick: Median ${median(v19Errors).toFixed(2)}%, Pass ≤1%: ${passCount(v19Errors, 1)}/${quickResults.length}`);
  console.log('');

  // Test full engine with metrics for a few wallets
  console.log('-'.repeat(120));
  console.log('FULL ENGINE TEST (createV19Engine)');
  console.log('-'.repeat(120));
  console.log('');

  const engine = createV19Engine();

  // Test 3 wallets with full metrics
  const testWallets = Array.from(benchmarks.keys()).slice(0, 5);

  for (const wallet of testWallets) {
    const benchmark = benchmarks.get(wallet)!;
    const username = benchmark.ui?.username || 'Unknown';

    console.log(`\n${username} (${wallet.substring(0, 10)}...):`);

    const metrics = await engine.compute(wallet);

    console.log(`  Total PnL: $${metrics.total_pnl.toFixed(2)} (UI: $${benchmark.ui?.pnl?.toFixed(2) || 'N/A'})`);
    console.log(`  Realized: $${metrics.realized_pnl.toFixed(2)}, Unrealized: $${metrics.unrealized_pnl.toFixed(2)}`);
    console.log(`  Positions: ${metrics.positions_count}, Markets: ${metrics.markets_traded}, Trades: ${metrics.total_trades}`);
    console.log(`  Win Rate: ${(metrics.win_rate * 100).toFixed(1)}%`);
    console.log(`  Omega: ${metrics.omega_ratio.toFixed(2)}`);
    console.log(`  Sharpe: ${metrics.sharpe_ratio?.toFixed(2) || 'N/A'}`);
    console.log(`  Sortino: ${metrics.sortino_ratio?.toFixed(2) || 'N/A'}`);

    if (metrics.by_category.length > 0) {
      console.log(`  Categories (top 3):`);
      for (const cat of metrics.by_category.slice(0, 3)) {
        console.log(
          `    ${cat.category.substring(0, 15).padEnd(15)}: $${cat.realized_pnl.toFixed(2).padStart(8)} | ` +
            `Win: ${(cat.win_rate * 100).toFixed(0)}% | Omega: ${cat.omega_ratio.toFixed(2)}`
        );
      }
    }
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('V19 ENGINE TEST COMPLETE');
  console.log('='.repeat(120));
}

main().catch(console.error);
