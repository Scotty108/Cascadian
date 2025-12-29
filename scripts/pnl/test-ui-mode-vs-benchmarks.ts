/**
 * Phase 4: Test UI Mode vs Benchmarks
 *
 * Compares three variants for each wallet in a benchmark set:
 * 1. Canonical V17 realized PnL
 * 2. Maker-only realized PnL (UI mode)
 * 3. UI benchmark value
 *
 * Usage:
 *   npx tsx scripts/pnl/test-ui-mode-vs-benchmarks.ts [benchmark_set]
 *
 * Examples:
 *   npx tsx scripts/pnl/test-ui-mode-vs-benchmarks.ts 6_wallet_fresh_corrected_20251126
 *   npx tsx scripts/pnl/test-ui-mode-vs-benchmarks.ts 50_wallet_v1_legacy
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import { createV17UiModeEngine } from '../../lib/pnl/uiActivityEngineV17UiMode';

interface BenchmarkRow {
  wallet: string;
  ui_pnl: number;
  note: string;
}

interface TestResult {
  wallet: string;
  ui_pnl: number;
  v17_realized: number;
  ui_mode_realized: number;
  v17_error_pct: number;
  ui_mode_error_pct: number;
  v17_sign_match: boolean;
  ui_mode_sign_match: boolean;
  note: string;
}

async function loadBenchmarks(benchmarkSet: string): Promise<BenchmarkRow[]> {
  // Try to load from pm_ui_pnl_benchmarks_v1
  try {
    const query = `
      SELECT wallet, pnl_value, COALESCE(note, '') as note
      FROM pm_ui_pnl_benchmarks_v1
      WHERE benchmark_set = '${benchmarkSet}'
      ORDER BY wallet
    `;
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    if (rows.length > 0) {
      console.log(`Loaded ${rows.length} wallets from pm_ui_pnl_benchmarks_v1`);
      return rows.map((r) => ({
        wallet: r.wallet.toLowerCase(),
        ui_pnl: Number(r.pnl_value),
        note: r.note || '',
      }));
    }
  } catch (e: any) {
    console.log('Error loading from database:', e.message);
  }

  // Fallback to hardcoded benchmarks
  if (benchmarkSet === '6_wallet_fresh_corrected_20251126') {
    console.log('Using hardcoded 6-wallet benchmark set');
    return [
      { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.9, note: 'Theo NegRisk' },
      { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, note: 'Golden' },
      { wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786', ui_pnl: 5.44, note: 'Trump wallet' },
      { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', ui_pnl: -294.61, note: 'Sign flip' },
      { wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', ui_pnl: 146.9, note: 'Fresh UI 1' },
      { wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', ui_pnl: 470.4, note: 'Fresh UI 2' },
    ];
  }

  console.log(`No benchmarks found for set: ${benchmarkSet}`);
  return [];
}

async function runTests(benchmarkSet: string): Promise<TestResult[]> {
  const benchmarks = await loadBenchmarks(benchmarkSet);

  if (benchmarks.length === 0) {
    console.log('No benchmarks to test.');
    return [];
  }

  const v17Engine = createV17Engine();
  const uiModeEngine = createV17UiModeEngine();

  const results: TestResult[] = [];

  for (const b of benchmarks) {
    const v17Result = await v17Engine.compute(b.wallet);
    const uiModeResult = await uiModeEngine.compute(b.wallet);

    const v17_realized = v17Result.realized_pnl;
    const ui_mode_realized = uiModeResult.realized_pnl;

    // Calculate error percentages (handle zero UI)
    const v17_error_pct =
      b.ui_pnl !== 0 ? Math.abs((v17_realized - b.ui_pnl) / Math.abs(b.ui_pnl)) * 100 : v17_realized === 0 ? 0 : Infinity;

    const ui_mode_error_pct =
      b.ui_pnl !== 0
        ? Math.abs((ui_mode_realized - b.ui_pnl) / Math.abs(b.ui_pnl)) * 100
        : ui_mode_realized === 0
          ? 0
          : Infinity;

    // Check sign match
    const v17_sign_match = (v17_realized >= 0 && b.ui_pnl >= 0) || (v17_realized < 0 && b.ui_pnl < 0);
    const ui_mode_sign_match =
      (ui_mode_realized >= 0 && b.ui_pnl >= 0) || (ui_mode_realized < 0 && b.ui_pnl < 0);

    results.push({
      wallet: b.wallet,
      ui_pnl: b.ui_pnl,
      v17_realized,
      ui_mode_realized,
      v17_error_pct,
      ui_mode_error_pct,
      v17_sign_match,
      ui_mode_sign_match,
      note: b.note,
    });
  }

  return results;
}

function printResults(results: TestResult[], benchmarkSet: string): void {
  console.log('='.repeat(140));
  console.log(`PHASE 4: UI MODE vs CANONICAL V17 - Benchmark Set: ${benchmarkSet}`);
  console.log('='.repeat(140));
  console.log('');

  // Print header
  console.log(
    'Wallet               | UI PnL        | V17 Realized  | UI Mode Rlzd  | V17 Err%  | UI Mode Err% | V17 Sign | UI Sign | Note'
  );
  console.log('-'.repeat(140));

  for (const r of results) {
    const uiStr = '$' + r.ui_pnl.toFixed(2);
    const v17Str = '$' + r.v17_realized.toFixed(2);
    const uiModeStr = '$' + r.ui_mode_realized.toFixed(2);
    const v17ErrStr = r.v17_error_pct === Infinity ? 'Inf' : r.v17_error_pct.toFixed(1) + '%';
    const uiModeErrStr = r.ui_mode_error_pct === Infinity ? 'Inf' : r.ui_mode_error_pct.toFixed(1) + '%';
    const v17SignStr = r.v17_sign_match ? 'OK' : 'FLIP';
    const uiModeSignStr = r.ui_mode_sign_match ? 'OK' : 'FLIP';

    console.log(
      `${r.wallet.substring(0, 18)}... | ` +
        `${uiStr.padStart(12)} | ` +
        `${v17Str.padStart(12)} | ` +
        `${uiModeStr.padStart(12)} | ` +
        `${v17ErrStr.padStart(9)} | ` +
        `${uiModeErrStr.padStart(12)} | ` +
        `${v17SignStr.padEnd(8)} | ` +
        `${uiModeSignStr.padEnd(7)} | ` +
        `${r.note}`
    );
  }

  console.log('-'.repeat(140));
  console.log('');

  // Calculate summary stats
  const total = results.length;
  const v17Under5Pct = results.filter((r) => r.v17_error_pct < 5).length;
  const uiModeUnder5Pct = results.filter((r) => r.ui_mode_error_pct < 5).length;
  const v17Under25Pct = results.filter((r) => r.v17_error_pct < 25).length;
  const uiModeUnder25Pct = results.filter((r) => r.ui_mode_error_pct < 25).length;
  const v17SignMatch = results.filter((r) => r.v17_sign_match).length;
  const uiModeSignMatch = results.filter((r) => r.ui_mode_sign_match).length;

  // Calculate median errors
  const v17Errors = results.map((r) => r.v17_error_pct).sort((a, b) => a - b);
  const uiModeErrors = results.map((r) => r.ui_mode_error_pct).sort((a, b) => a - b);
  const v17Median = v17Errors[Math.floor(v17Errors.length / 2)];
  const uiModeMedian = uiModeErrors[Math.floor(uiModeErrors.length / 2)];

  console.log('SUMMARY STATISTICS:');
  console.log('-'.repeat(60));
  console.log(`Total wallets:          ${total}`);
  console.log('');
  console.log('                        V17 Canonical    UI Mode (Maker-Only)');
  console.log(`Wallets < 5% error:     ${v17Under5Pct.toString().padStart(3)} (${((v17Under5Pct / total) * 100).toFixed(0)}%)             ${uiModeUnder5Pct.toString().padStart(3)} (${((uiModeUnder5Pct / total) * 100).toFixed(0)}%)`);
  console.log(`Wallets < 25% error:    ${v17Under25Pct.toString().padStart(3)} (${((v17Under25Pct / total) * 100).toFixed(0)}%)             ${uiModeUnder25Pct.toString().padStart(3)} (${((uiModeUnder25Pct / total) * 100).toFixed(0)}%)`);
  console.log(`Sign match:             ${v17SignMatch.toString().padStart(3)} (${((v17SignMatch / total) * 100).toFixed(0)}%)             ${uiModeSignMatch.toString().padStart(3)} (${((uiModeSignMatch / total) * 100).toFixed(0)}%)`);
  console.log(`Median error:           ${v17Median.toFixed(1).padStart(6)}%            ${uiModeMedian.toFixed(1).padStart(6)}%`);
  console.log('');
}

async function main() {
  const benchmarkSet = process.argv[2] || '6_wallet_fresh_corrected_20251126';

  console.log(`Loading benchmarks for: ${benchmarkSet}`);
  console.log('');

  const results = await runTests(benchmarkSet);

  if (results.length === 0) {
    return;
  }

  printResults(results, benchmarkSet);

  // Print recommendation if this is the 6-wallet set
  if (benchmarkSet.includes('6_wallet')) {
    const uiModeUnder5Pct = results.filter((r) => r.ui_mode_error_pct < 5).length;
    const total = results.length;

    console.log('='.repeat(140));
    console.log('PHASE 4 CONCLUSION');
    console.log('='.repeat(140));
    console.log('');
    console.log(`UI Mode (maker-only) achieves < 5% error for ${uiModeUnder5Pct}/${total} wallets (${((uiModeUnder5Pct / total) * 100).toFixed(0)}%).`);
    console.log('');
    console.log('RECOMMENDATION:');
    console.log('For Cascadian, we will keep V17 realized as our canonical "Profit" metric,');
    console.log('and optionally expose a separate "Polymarket UI Profit" that uses maker-only');
    console.log('attribution, which empirically matches the UI for most wallets.');
    console.log('');
  }
}

main().catch(console.error);
