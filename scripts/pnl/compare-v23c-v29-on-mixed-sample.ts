/**
 * ============================================================================
 * V23C vs V29 COMPARISON ON MIXED WALLET SAMPLE
 * ============================================================================
 *
 * PURPOSE: Quick reality check to see if V23C truly outperforms V29 in practice
 *
 * APPROACH:
 * - Load 25 mixed wallets (13 SAFE_STRICT + 12 random trader_strict)
 * - Compute V23C PnL (with UI oracle)
 * - Compute V29 PnL (inventory engine)
 * - Compare against UI benchmarks where available
 * - Output JSONL results + summary
 *
 * USAGE:
 *   npx tsx scripts/pnl/compare-v23c-v29-on-mixed-sample.ts
 *   npx tsx scripts/pnl/compare-v23c-v29-on-mixed-sample.ts --limit=10
 *   npx tsx scripts/pnl/compare-v23c-v29-on-mixed-sample.ts --concurrency=2
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV23cPnL } from '../../lib/pnl/shadowLedgerV23c';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  limit: number;
  concurrency: number;
  walletTimeoutMs: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let limit = 25;
  let concurrency = 4;
  let walletTimeoutMs = 20000;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 25;
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1], 10) || 4;
    } else if (arg.startsWith('--wallet-timeout-ms=')) {
      walletTimeoutMs = parseInt(arg.split('=')[1], 10) || 20000;
    }
  }

  return { limit, concurrency, walletTimeoutMs };
}

// ============================================================================
// Types
// ============================================================================

interface WalletSample {
  metadata: {
    created: string;
    purpose: string;
    source_breakdown: any;
    notes: string;
  };
  wallets: string[];
}

interface UIBenchmark {
  wallet: string;
  ui_pnl: number;
  benchmark_set: string;
}

interface WalletResult {
  wallet: string;
  ui_pnl: number | null;
  v23c_pnl: number;
  v29_pnl: number;
  v29_realized_pnl: number;
  v29_resolved_unredeemed: number;
  abs_error_v23c: number | null;
  abs_error_v29: number | null;
  pct_error_v23c: number | null;
  pct_error_v29: number | null;
  winner: 'V23C' | 'V29' | 'TIE' | 'NO_UI';
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatPnL(n: number | null): string {
  if (n === null) return 'N/A';
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${errorMsg}`)), timeoutMs)
    ),
  ]);
}

// ============================================================================
// UI Benchmark Loader
// ============================================================================

async function loadUIBenchmarks(wallets: string[]): Promise<Map<string, number>> {
  const benchmarkMap = new Map<string, number>();

  // Try to load from pm_ui_pnl_benchmarks_v1 first
  try {
    const walletsLower = wallets.map(w => w.toLowerCase());
    const walletList = walletsLower.map(w => `'${w}'`).join(', ');

    const query = `
      SELECT
        lower(wallet) as wallet,
        pnl_value as ui_pnl,
        benchmark_set
      FROM pm_ui_pnl_benchmarks_v1
      WHERE lower(wallet) IN (${walletList})
      ORDER BY captured_at DESC
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    // Take the most recent benchmark for each wallet
    const seen = new Set<string>();
    for (const row of rows) {
      const wallet = row.wallet.toLowerCase();
      if (!seen.has(wallet)) {
        benchmarkMap.set(wallet, Number(row.ui_pnl));
        seen.add(wallet);
      }
    }

    console.log(`  Loaded ${benchmarkMap.size} UI benchmarks from pm_ui_pnl_benchmarks_v1`);
  } catch (err: any) {
    console.log(`  Warning: Could not load UI benchmarks: ${err.message}`);
  }

  // Fallback: check if we have them in safe_trader_strict_wallets_2025_12_06.json
  if (benchmarkMap.size === 0) {
    try {
      const safeWalletsPath = './tmp/safe_trader_strict_wallets_2025_12_06.json';
      if (fs.existsSync(safeWalletsPath)) {
        const data = JSON.parse(fs.readFileSync(safeWalletsPath, 'utf-8'));
        for (const item of data) {
          if (item.wallet && item.uiPnL !== undefined) {
            benchmarkMap.set(item.wallet.toLowerCase(), item.uiPnL);
          }
        }
        console.log(`  Loaded ${benchmarkMap.size} UI benchmarks from safe_trader_strict_wallets_2025_12_06.json`);
      }
    } catch (err: any) {
      console.log(`  Warning: Could not load fallback benchmarks: ${err.message}`);
    }
  }

  return benchmarkMap;
}

// ============================================================================
// Engine Runners
// ============================================================================

async function computeV23C(wallet: string, timeoutMs: number): Promise<number> {
  const result = await withTimeout(
    calculateV23cPnL(wallet, { useUIOracle: true }),
    timeoutMs,
    `V23C calculation for ${wallet}`
  );
  return result.totalPnl;
}

async function computeV29(wallet: string, timeoutMs: number): Promise<{ totalPnl: number; realizedPnl: number; resolvedUnredeemed: number }> {
  const result = await withTimeout(
    calculateV29PnL(wallet, { inventoryGuard: true, useMaterializedTable: true }),
    timeoutMs,
    `V29 calculation for ${wallet}`
  );

  // V29 has two flavors: realized (cash-only) and uiParity (includes resolved-unredeemed)
  // For comparison, we use totalPnl (which is uiParityPnl in V29)
  const resolvedUnredeemed = result.totalPnl - result.realizedPnl;

  return {
    totalPnl: result.totalPnl,
    realizedPnl: result.realizedPnl,
    resolvedUnredeemed,
  };
}

// ============================================================================
// Batch Processing
// ============================================================================

async function processWallet(
  wallet: string,
  uiBenchmarks: Map<string, number>,
  config: Config
): Promise<WalletResult> {
  const walletLower = wallet.toLowerCase();
  const ui_pnl = uiBenchmarks.get(walletLower) ?? null;

  try {
    const [v23c_pnl, v29Result] = await Promise.all([
      computeV23C(wallet, config.walletTimeoutMs),
      computeV29(wallet, config.walletTimeoutMs),
    ]);

    const v29_pnl = v29Result.totalPnl;
    const v29_realized_pnl = v29Result.realizedPnl;
    const v29_resolved_unredeemed = v29Result.resolvedUnredeemed;

    let abs_error_v23c: number | null = null;
    let abs_error_v29: number | null = null;
    let pct_error_v23c: number | null = null;
    let pct_error_v29: number | null = null;
    let winner: 'V23C' | 'V29' | 'TIE' | 'NO_UI' = 'NO_UI';

    if (ui_pnl !== null) {
      abs_error_v23c = Math.abs(v23c_pnl - ui_pnl);
      abs_error_v29 = Math.abs(v29_pnl - ui_pnl);
      pct_error_v23c = errorPct(v23c_pnl, ui_pnl);
      pct_error_v29 = errorPct(v29_pnl, ui_pnl);

      // Determine winner based on absolute error
      if (abs_error_v23c < abs_error_v29) {
        winner = 'V23C';
      } else if (abs_error_v29 < abs_error_v23c) {
        winner = 'V29';
      } else {
        winner = 'TIE';
      }
    }

    return {
      wallet,
      ui_pnl,
      v23c_pnl,
      v29_pnl,
      v29_realized_pnl,
      v29_resolved_unredeemed,
      abs_error_v23c,
      abs_error_v29,
      pct_error_v23c,
      pct_error_v29,
      winner,
    };
  } catch (err: any) {
    return {
      wallet,
      ui_pnl,
      v23c_pnl: 0,
      v29_pnl: 0,
      v29_realized_pnl: 0,
      v29_resolved_unredeemed: 0,
      abs_error_v23c: null,
      abs_error_v29: null,
      pct_error_v23c: null,
      pct_error_v29: null,
      winner: 'NO_UI',
      error: err.message,
    };
  }
}

async function processBatch(
  wallets: string[],
  uiBenchmarks: Map<string, number>,
  config: Config
): Promise<WalletResult[]> {
  const results: WalletResult[] = [];
  const batches: string[][] = [];

  // Split into batches
  for (let i = 0; i < wallets.length; i += config.concurrency) {
    batches.push(wallets.slice(i, i + config.concurrency));
  }

  // Process batches sequentially (wallets within batch run in parallel)
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(`Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} wallets)...`);

    const batchResults = await Promise.all(
      batch.map(wallet => processWallet(wallet, uiBenchmarks, config))
    );

    results.push(...batchResults);

    // Print progress
    for (const result of batchResults) {
      const status = result.error ? `ERROR: ${result.error}` : `${result.winner}`;
      console.log(`  ${result.wallet.substring(0, 12)}... -> ${status}`);
    }
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(100));
  console.log('V23C vs V29 COMPARISON ON MIXED WALLET SAMPLE');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Config: limit=${config.limit}, concurrency=${config.concurrency}, timeout=${config.walletTimeoutMs}ms`);
  console.log('');

  // Step 1: Load wallet sample
  console.log('STEP 1: Loading wallet sample...');
  const samplePath = './tmp/mixed_wallets_v23c_v29_check.json';
  if (!fs.existsSync(samplePath)) {
    console.error(`ERROR: Wallet sample not found at ${samplePath}`);
    process.exit(1);
  }

  const sample: WalletSample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  const wallets = sample.wallets.slice(0, config.limit);

  console.log(`  Loaded ${wallets.length} wallets from ${samplePath}`);
  console.log(`  Source breakdown: ${JSON.stringify(sample.metadata.source_breakdown)}`);
  console.log('');

  // Step 2: Load UI benchmarks
  console.log('STEP 2: Loading UI benchmarks...');
  const uiBenchmarks = await loadUIBenchmarks(wallets);
  console.log('');

  // Step 3: Process wallets
  console.log('STEP 3: Computing V23C and V29 PnL...');
  const results = await processBatch(wallets, uiBenchmarks, config);
  console.log('');

  // Step 4: Write JSONL output
  console.log('STEP 4: Writing results...');
  const jsonlPath = './tmp/v23c_v29_mixed_results.jsonl';
  const jsonlLines = results.map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(jsonlPath, jsonlLines);
  console.log(`  Wrote ${results.length} results to ${jsonlPath}`);
  console.log('');

  // Step 5: Summary statistics
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');

  const withUI = results.filter(r => r.ui_pnl !== null && !r.error);
  const v23cWins = withUI.filter(r => r.winner === 'V23C').length;
  const v29Wins = withUI.filter(r => r.winner === 'V29').length;
  const ties = withUI.filter(r => r.winner === 'TIE').length;
  const noUI = results.filter(r => r.winner === 'NO_UI').length;
  const errors = results.filter(r => r.error).length;

  console.log(`Total Wallets: ${results.length}`);
  console.log(`  With UI Benchmarks: ${withUI.length}`);
  console.log(`  No UI Benchmarks: ${noUI}`);
  console.log(`  Errors: ${errors}`);
  console.log('');

  if (withUI.length > 0) {
    console.log('Winner Breakdown (on UI benchmark wallets):');
    console.log(`  V23C Wins: ${v23cWins} (${((v23cWins / withUI.length) * 100).toFixed(1)}%)`);
    console.log(`  V29 Wins:  ${v29Wins} (${((v29Wins / withUI.length) * 100).toFixed(1)}%)`);
    console.log(`  Ties:      ${ties} (${((ties / withUI.length) * 100).toFixed(1)}%)`);
    console.log('');

    // Average errors
    const avgV23cError = withUI.reduce((sum, r) => sum + (r.abs_error_v23c ?? 0), 0) / withUI.length;
    const avgV29Error = withUI.reduce((sum, r) => sum + (r.abs_error_v29 ?? 0), 0) / withUI.length;
    const avgV23cPctError = withUI.reduce((sum, r) => sum + (r.pct_error_v23c ?? 0), 0) / withUI.length;
    const avgV29PctError = withUI.reduce((sum, r) => sum + (r.pct_error_v29 ?? 0), 0) / withUI.length;

    console.log('Average Errors:');
    console.log(`  V23C: ${formatPnL(avgV23cError)} (${avgV23cPctError.toFixed(2)}%)`);
    console.log(`  V29:  ${formatPnL(avgV29Error)} (${avgV29PctError.toFixed(2)}%)`);
    console.log('');

    // Top 5 biggest deltas (where V23C or V29 did much better)
    const sortedByDelta = [...withUI].sort((a, b) => {
      const deltaA = Math.abs((a.abs_error_v23c ?? 0) - (a.abs_error_v29 ?? 0));
      const deltaB = Math.abs((b.abs_error_v23c ?? 0) - (b.abs_error_v29 ?? 0));
      return deltaB - deltaA;
    });

    console.log('Top 5 Biggest Error Deltas:');
    console.log('Wallet           | UI PnL      | V23C Error  | V29 Error   | Winner');
    console.log('-'.repeat(90));
    for (let i = 0; i < Math.min(5, sortedByDelta.length); i++) {
      const r = sortedByDelta[i];
      console.log(
        `${r.wallet.substring(0, 15)}... | ${formatPnL(r.ui_pnl).padStart(11)} | ${formatPnL(r.abs_error_v23c).padStart(11)} | ${formatPnL(r.abs_error_v29).padStart(11)} | ${r.winner}`
      );
    }
    console.log('');
  }

  // Hypothesis section
  console.log('═'.repeat(100));
  console.log('HYPOTHESIS');
  console.log('═'.repeat(100));
  console.log('');

  if (withUI.length === 0) {
    console.log('⚠️  No UI benchmarks available - cannot determine winner.');
    console.log('');
    console.log('RECOMMENDATION: Capture UI benchmarks for these wallets first.');
  } else if (v23cWins > v29Wins) {
    const advantage = ((v23cWins - v29Wins) / withUI.length) * 100;
    console.log(`✅ V23C outperforms V29 by ${advantage.toFixed(1)}% on this mixed sample.`);
    console.log('');
    console.log('INTERPRETATION:');
    console.log('  - V23C UI oracle appears more accurate than V29 inventory engine');
    console.log('  - V29 may have systematic bias or data gaps');
    console.log('  - Consider using V23C as primary engine for UI parity');
  } else if (v29Wins > v23cWins) {
    const advantage = ((v29Wins - v23cWins) / withUI.length) * 100;
    console.log(`✅ V29 outperforms V23C by ${advantage.toFixed(1)}% on this mixed sample.`);
    console.log('');
    console.log('INTERPRETATION:');
    console.log('  - V29 inventory accounting may be more accurate than V23C shadow ledger');
    console.log('  - V23C UI oracle may have stale prices or missing data');
    console.log('  - V29 is the better choice for production');
  } else {
    console.log('⚖️  V23C and V29 perform equally on this sample.');
    console.log('');
    console.log('INTERPRETATION:');
    console.log('  - Both engines have similar accuracy');
    console.log('  - Performance and complexity may be the deciding factors');
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('Terminal 2 | 2025-12-06');
  console.log('═'.repeat(100));
}

main().catch(console.error);
