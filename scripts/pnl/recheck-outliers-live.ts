/**
 * ============================================================================
 * OUTLIER RECHECK LIVE - Verify Benchmark Accuracy via Live API
 * ============================================================================
 *
 * PURPOSE: Fast sanity check for worst-performing wallets before engine changes
 *
 * INPUT: JSON results file from compare scripts
 * BEHAVIOR:
 * - Extract worst 10-25 wallets by abs_error
 * - Fetch live PnL from Polymarket Profile API
 * - Compare against benchmark to confirm if benchmark was wrong
 * - Output short validation report
 *
 * USAGE:
 *   npx tsx scripts/pnl/recheck-outliers-live.ts tmp/v23c_vs_v29_trader_strict_fast_20.json
 *   npx tsx scripts/pnl/recheck-outliers-live.ts --input=results.json --top=15
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  inputFile: string;
  topN: number;
  outputFile: string | null;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let inputFile = '';
  let topN = 10;
  let outputFile: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      inputFile = arg.split('=')[1];
    } else if (arg.startsWith('--top=')) {
      topN = parseInt(arg.split('=')[1], 10) || 10;
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      inputFile = arg;
    }
  }

  return { inputFile, topN, outputFile };
}

// ============================================================================
// Types
// ============================================================================

interface WalletResult {
  wallet: string;
  ui_pnl: number | null;
  v23c_pnl?: number;
  v29_pnl?: number;
  abs_error_usd_v23c?: number | null;
  abs_error_usd_v29?: number | null;
  abs_error_v23c?: number | null;
  abs_error_v29?: number | null;
}

interface LiveAPIResponse {
  pnl?: number;
  totalPnl?: number;
  error?: string;
}

interface OutlierRecheck {
  wallet: string;
  benchmark_pnl: number;
  live_api_pnl: number | null;
  engine_pnl: number;
  benchmark_error: number;
  engine_error: number | null;
  live_api_error: string | null;
  verdict: 'BENCHMARK_WRONG' | 'ENGINE_WRONG' | 'BOTH_WRONG' | 'UNKNOWN' | 'API_ERROR';
}

// ============================================================================
// Live API Fetcher
// ============================================================================

async function fetchLivePnL(wallet: string): Promise<LiveAPIResponse> {
  try {
    const url = `https://gamma-api.polymarket.com/profile/${wallet}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();

    // Try multiple PnL field names
    const pnl = data.pnl ?? data.totalPnl ?? data.total_pnl ?? data.allTimePnl;

    if (pnl === undefined) {
      return { error: 'No PnL field found in API response' };
    }

    return { pnl: Number(pnl) };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatPnL(n: number | null): string {
  if (n === null) return 'N/A';
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  if (!config.inputFile) {
    console.error('ERROR: No input file specified');
    console.error('Usage: npx tsx scripts/pnl/recheck-outliers-live.ts <input.json>');
    process.exit(1);
  }

  if (!fs.existsSync(config.inputFile)) {
    console.error(`ERROR: Input file not found: ${config.inputFile}`);
    process.exit(1);
  }

  console.log('═'.repeat(100));
  console.log('OUTLIER RECHECK - Live API Validation');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Input: ${config.inputFile}`);
  console.log(`Top N: ${config.topN}`);
  console.log('');

  // Step 1: Load results
  console.log('STEP 1: Loading comparison results...');
  const results: WalletResult[] = JSON.parse(fs.readFileSync(config.inputFile, 'utf-8'));
  console.log(`  Loaded ${results.length} wallet results`);
  console.log('');

  // Step 2: Extract worst outliers
  console.log('STEP 2: Extracting worst outliers...');

  // Find worst by absolute error (try both field names for backward compat)
  const withErrors = results.filter(r => {
    const v29Error = r.abs_error_usd_v29 ?? r.abs_error_v29;
    const v23cError = r.abs_error_usd_v23c ?? r.abs_error_v23c;
    return (v29Error !== null && v29Error !== undefined) || (v23cError !== null && v23cError !== undefined);
  });

  const sorted = withErrors.sort((a, b) => {
    const aError = Math.max(a.abs_error_usd_v29 ?? a.abs_error_v29 ?? 0, a.abs_error_usd_v23c ?? a.abs_error_v23c ?? 0);
    const bError = Math.max(b.abs_error_usd_v29 ?? b.abs_error_v29 ?? 0, b.abs_error_usd_v23c ?? b.abs_error_v23c ?? 0);
    return bError - aError;
  });

  const outliers = sorted.slice(0, config.topN);
  console.log(`  Selected ${outliers.length} worst outliers`);
  console.log('');

  // Step 3: Fetch live PnL for each outlier
  console.log('STEP 3: Fetching live PnL from Polymarket API...');
  const rechecks: OutlierRecheck[] = [];

  for (let i = 0; i < outliers.length; i++) {
    const result = outliers[i];
    const wallet = result.wallet;

    process.stdout.write(`  [${i + 1}/${outliers.length}] ${wallet.substring(0, 12)}... `);

    const liveResponse = await fetchLivePnL(wallet);

    if (liveResponse.error) {
      rechecks.push({
        wallet,
        benchmark_pnl: result.ui_pnl ?? 0,
        live_api_pnl: null,
        engine_pnl: result.v29_pnl ?? result.v23c_pnl ?? 0,
        benchmark_error: result.abs_error_usd_v29 ?? result.abs_error_v29 ?? 0,
        engine_error: null,
        live_api_error: liveResponse.error,
        verdict: 'API_ERROR',
      });
      console.log(`API ERROR: ${liveResponse.error}`);
    } else {
      const live_pnl = liveResponse.pnl!;
      const benchmark_pnl = result.ui_pnl ?? 0;
      const engine_pnl = result.v29_pnl ?? result.v23c_pnl ?? 0;

      const benchmark_error = Math.abs(engine_pnl - benchmark_pnl);
      const live_error = Math.abs(engine_pnl - live_pnl);

      let verdict: OutlierRecheck['verdict'] = 'UNKNOWN';

      // If live API is much closer to engine than benchmark, benchmark is wrong
      if (live_error < benchmark_error * 0.5) {
        verdict = 'BENCHMARK_WRONG';
      } else if (live_error > benchmark_error * 2) {
        verdict = 'ENGINE_WRONG';
      } else if (Math.abs(live_pnl - benchmark_pnl) > Math.max(live_error, benchmark_error)) {
        verdict = 'BOTH_WRONG';
      }

      rechecks.push({
        wallet,
        benchmark_pnl,
        live_api_pnl: live_pnl,
        engine_pnl,
        benchmark_error,
        engine_error: live_error,
        live_api_error: null,
        verdict,
      });

      console.log(`${formatPnL(live_pnl)} -> ${verdict}`);
    }

    // Rate limit: 500ms between requests
    if (i < outliers.length - 1) {
      await sleep(500);
    }
  }

  console.log('');

  // Step 4: Summary
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');

  const verdictCounts = {
    BENCHMARK_WRONG: rechecks.filter(r => r.verdict === 'BENCHMARK_WRONG').length,
    ENGINE_WRONG: rechecks.filter(r => r.verdict === 'ENGINE_WRONG').length,
    BOTH_WRONG: rechecks.filter(r => r.verdict === 'BOTH_WRONG').length,
    UNKNOWN: rechecks.filter(r => r.verdict === 'UNKNOWN').length,
    API_ERROR: rechecks.filter(r => r.verdict === 'API_ERROR').length,
  };

  console.log('Verdict Breakdown:');
  console.log(`  BENCHMARK_WRONG: ${verdictCounts.BENCHMARK_WRONG} (${((verdictCounts.BENCHMARK_WRONG / rechecks.length) * 100).toFixed(1)}%)`);
  console.log(`  ENGINE_WRONG:    ${verdictCounts.ENGINE_WRONG} (${((verdictCounts.ENGINE_WRONG / rechecks.length) * 100).toFixed(1)}%)`);
  console.log(`  BOTH_WRONG:      ${verdictCounts.BOTH_WRONG} (${((verdictCounts.BOTH_WRONG / rechecks.length) * 100).toFixed(1)}%)`);
  console.log(`  UNKNOWN:         ${verdictCounts.UNKNOWN} (${((verdictCounts.UNKNOWN / rechecks.length) * 100).toFixed(1)}%)`);
  console.log(`  API_ERROR:       ${verdictCounts.API_ERROR} (${((verdictCounts.API_ERROR / rechecks.length) * 100).toFixed(1)}%)`);
  console.log('');

  // Detail table
  console.log('Detailed Results:');
  console.log('');
  console.log('Wallet           | Benchmark    | Live API     | Engine PnL   | Verdict');
  console.log('-'.repeat(90));

  for (const recheck of rechecks) {
    console.log(
      `${recheck.wallet.substring(0, 15)}... | ${formatPnL(recheck.benchmark_pnl).padStart(12)} | ${formatPnL(recheck.live_api_pnl).padStart(12)} | ${formatPnL(recheck.engine_pnl).padStart(12)} | ${recheck.verdict}`
    );
  }

  console.log('');

  // Recommendation
  if (verdictCounts.BENCHMARK_WRONG >= rechecks.length * 0.5) {
    console.log('🚨 RECOMMENDATION: >50% of outliers have BENCHMARK_WRONG');
    console.log('   Action: Re-scrape UI benchmarks using fresh Playwright run');
  } else if (verdictCounts.ENGINE_WRONG >= rechecks.length * 0.5) {
    console.log('🚨 RECOMMENDATION: >50% of outliers have ENGINE_WRONG');
    console.log('   Action: Investigate engine logic for these wallets');
  } else {
    console.log('✅ RECOMMENDATION: Mixed results - investigate case-by-case');
  }

  console.log('');

  // Step 5: Write output
  if (config.outputFile) {
    fs.writeFileSync(config.outputFile, JSON.stringify(rechecks, null, 2));
    console.log(`Wrote detailed results to ${config.outputFile}`);
    console.log('');
  }

  console.log('═'.repeat(100));
  console.log(`Terminal 2 | ${new Date().toISOString()}`);
  console.log('═'.repeat(100));
}

main().catch(console.error);
