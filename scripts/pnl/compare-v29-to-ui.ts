/**
 * ============================================================================
 * V29 PNL ENGINE VS POLYMARKET UI COMPARISON (Track A: Realized-Only)
 * ============================================================================
 *
 * METHODOLOGY (Updated 2025-12-06):
 * - Compares V29 REALIZED PnL against Polymarket leaderboard API "pnl" field
 * - The leaderboard "pnl" field is the authoritative UI "All-Time Profit/Loss"
 * - Do NOT include V29 unrealized in the primary comparison
 * - The value endpoint returns "positions value", NOT unrealized PnL
 *
 * Run: npx tsx scripts/pnl/compare-v29-to-ui.ts
 *      npx tsx scripts/pnl/compare-v29-to-ui.ts --limit=25
 *      npx tsx scripts/pnl/compare-v29-to-ui.ts --wallet=0x1234...
 *
 * Terminal: Claude 1
 * Date: 2025-12-06
 */

import { calculateV29PnL, V29Options } from '../../lib/pnl/inventoryEngineV29';
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

interface CompareConfig {
  limit: number;
  wallets?: string[]; // Specific wallets to test
  outputPath: string;
}

function parseArgs(): CompareConfig {
  const args = process.argv.slice(2);
  let limit = 10;
  let wallets: string[] | undefined;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 10;
    } else if (arg.startsWith('--wallet=')) {
      const wallet = arg.split('=')[1];
      wallets = wallets || [];
      wallets.push(wallet.toLowerCase());
    }
  }

  return {
    limit,
    wallets,
    outputPath: path.join(process.cwd(), 'tmp', 'v29-ui-parity-report.json'),
  };
}

// ============================================================================
// UI API Fetcher
// ============================================================================

interface UIPnLResult {
  wallet: string;
  uiProfitLoss: number | null;  // Renamed from uiPnL for clarity
  uiVolume: number | null;
  userName?: string;
  uiSource: string;  // Explicit field source label
  error?: string;
  fetchedAt: string;
}

interface LeaderboardResponse {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

/**
 * Fetch wallet Profit/Loss from Polymarket's leaderboard API.
 *
 * IMPORTANT: The "pnl" field from this API is the authoritative
 * "All-Time Profit/Loss" shown in the UI profile.
 *
 * This is NOT the same as "portfolio value" or "positions value".
 */
async function fetchWalletProfitLoss(wallet: string): Promise<UIPnLResult> {
  const url = `https://data-api.polymarket.com/v1/leaderboard?timePeriod=all&orderBy=PNL&limit=1&offset=0&category=overall&user=${wallet}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        wallet,
        uiProfitLoss: null,
        uiVolume: null,
        uiSource: 'leaderboard.pnl (error)',
        error: `HTTP ${response.status}: ${response.statusText}`,
        fetchedAt: new Date().toISOString(),
      };
    }

    const data: LeaderboardResponse[] = await response.json();

    if (!data || data.length === 0) {
      return {
        wallet,
        uiProfitLoss: null,
        uiVolume: null,
        uiSource: 'leaderboard.pnl (no data)',
        error: 'No leaderboard data returned',
        fetchedAt: new Date().toISOString(),
      };
    }

    const entry = data[0];
    return {
      wallet,
      uiProfitLoss: entry.pnl,
      uiVolume: entry.vol,
      userName: entry.userName || undefined,
      uiSource: 'leaderboard.pnl',  // Explicit source label
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      wallet,
      uiProfitLoss: null,
      uiVolume: null,
      uiSource: 'leaderboard.pnl (error)',
      error: error.message,
      fetchedAt: new Date().toISOString(),
    };
  }
}

// ============================================================================
// Comparison Logic (Realized-Only)
// ============================================================================

interface ComparisonResult {
  wallet: string;
  // V29 Engine outputs
  v29RealizedPnL: number;  // Primary comparison field
  v29Events: number;
  v29Clamped: number;
  // UI outputs
  uiProfitLoss: number | null;
  uiVolume: number | null;
  uiSource: string;
  userName?: string;
  // Comparison metrics
  difference: number | null;
  differenceAbs: number | null;
  differencePct: number | null;
  matchLevel: 'exact_1' | 'close_5' | 'close_10' | 'moderate' | 'large' | 'unknown';
  // Metadata
  fetchedAt: string;
  error?: string;
}

/**
 * Classify match level based on absolute difference.
 *
 * Per Track A: Use absolute thresholds for tighter classification:
 * - <$1: exact match
 * - <$5: close match
 * - <$10: acceptable variance
 * - <20%: moderate (percentage-based for large values)
 * - >20%: large mismatch
 */
function classifyMatch(v29Realized: number, uiProfitLoss: number | null): ComparisonResult['matchLevel'] {
  if (uiProfitLoss === null) return 'unknown';

  const diff = Math.abs(v29Realized - uiProfitLoss);
  const pctDiff = uiProfitLoss !== 0 ? (diff / Math.abs(uiProfitLoss)) * 100 : (v29Realized === 0 ? 0 : 100);

  if (diff < 1) return 'exact_1';      // Within $1
  if (diff < 5) return 'close_5';      // Within $5
  if (diff < 10) return 'close_10';    // Within $10
  if (pctDiff < 20) return 'moderate'; // Within 20%
  return 'large';                       // More than 20% off
}

async function compareWallet(
  wallet: string,
  options: V29Options
): Promise<ComparisonResult> {
  // Calculate V29 PnL (realized only for comparison)
  const v29Result = await calculateV29PnL(wallet, options);

  // Fetch UI Profit/Loss from Polymarket API
  const uiResult = await fetchWalletProfitLoss(wallet);

  // Compare V29 REALIZED against UI Profit/Loss
  const difference = uiResult.uiProfitLoss !== null ? v29Result.realizedPnl - uiResult.uiProfitLoss : null;
  const differenceAbs = difference !== null ? Math.abs(difference) : null;
  const differencePct = uiResult.uiProfitLoss !== null && uiResult.uiProfitLoss !== 0
    ? (Math.abs(difference!) / Math.abs(uiResult.uiProfitLoss)) * 100
    : null;

  return {
    wallet,
    v29RealizedPnL: v29Result.realizedPnl,
    v29Events: v29Result.eventsProcessed,
    v29Clamped: v29Result.clampedPositions,
    uiProfitLoss: uiResult.uiProfitLoss,
    uiVolume: uiResult.uiVolume,
    uiSource: uiResult.uiSource,
    userName: uiResult.userName,
    difference,
    differenceAbs,
    differencePct,
    matchLevel: classifyMatch(v29Result.realizedPnl, uiResult.uiProfitLoss),
    fetchedAt: uiResult.fetchedAt,
    error: uiResult.error,
  };
}

// ============================================================================
// Wallet Sampling
// ============================================================================

async function sampleWalletsFromTable(limit: number): Promise<string[]> {
  // Sample wallets that have meaningful activity
  const result = await clickhouse.query({
    query: `
      SELECT wallet_address
      FROM pm_unified_ledger_v8_tbl
      WHERE source_type = 'CLOB'
      GROUP BY wallet_address
      HAVING count(*) >= 20  -- At least 20 CLOB events
      ORDER BY rand()
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows: any[] = await result.json();
  return rows.map(r => r.wallet_address);
}

// ============================================================================
// Report Generation
// ============================================================================

interface ParityReport {
  generatedAt: string;
  methodology: string;
  config: CompareConfig;
  summary: {
    totalWallets: number;
    successfulFetches: number;
    failedFetches: number;
    matchCounts: {
      exact_1: number;   // <$1
      close_5: number;   // <$5
      close_10: number;  // <$10
      moderate: number;  // <20%
      large: number;     // >20%
      unknown: number;
    };
    avgDifferenceAbs: number | null;
    avgDifferencePct: number | null;
  };
  results: ComparisonResult[];
  worstWallets: ComparisonResult[];  // Top 5 worst for debugging
}

function generateReport(config: CompareConfig, results: ComparisonResult[]): ParityReport {
  const successful = results.filter(r => r.uiProfitLoss !== null);

  const matchCounts = {
    exact_1: results.filter(r => r.matchLevel === 'exact_1').length,
    close_5: results.filter(r => r.matchLevel === 'close_5').length,
    close_10: results.filter(r => r.matchLevel === 'close_10').length,
    moderate: results.filter(r => r.matchLevel === 'moderate').length,
    large: results.filter(r => r.matchLevel === 'large').length,
    unknown: results.filter(r => r.matchLevel === 'unknown').length,
  };

  const diffsAbs = results.filter(r => r.differenceAbs !== null).map(r => r.differenceAbs!);
  const diffsPct = results.filter(r => r.differencePct !== null).map(r => r.differencePct!);

  // Get worst 5 wallets by absolute difference
  const worstWallets = [...results]
    .filter(r => r.differenceAbs !== null)
    .sort((a, b) => (b.differenceAbs ?? 0) - (a.differenceAbs ?? 0))
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    methodology: 'Track A: V29 Realized PnL vs UI Profit/Loss (leaderboard.pnl)',
    config,
    summary: {
      totalWallets: results.length,
      successfulFetches: successful.length,
      failedFetches: results.length - successful.length,
      matchCounts,
      avgDifferenceAbs: diffsAbs.length > 0 ? diffsAbs.reduce((a, b) => a + b, 0) / diffsAbs.length : null,
      avgDifferencePct: diffsPct.length > 0 ? diffsPct.reduce((a, b) => a + b, 0) / diffsPct.length : null,
    },
    results,
    worstWallets,
  };
}

function printReport(report: ParityReport): void {
  console.log('');
  console.log('='.repeat(80));
  console.log('V29 REALIZED PNL VS POLYMARKET UI PROFIT/LOSS');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Methodology: ${report.methodology}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log('');

  console.log('SUMMARY');
  console.log('-'.repeat(40));
  console.log(`Total wallets: ${report.summary.totalWallets}`);
  console.log(`Successful fetches: ${report.summary.successfulFetches}`);
  console.log(`Failed fetches: ${report.summary.failedFetches}`);
  console.log('');

  console.log('Match Distribution (V29 Realized vs UI Profit/Loss):');
  console.log(`  <$1 (exact):    ${report.summary.matchCounts.exact_1.toString().padStart(3)} (${(100 * report.summary.matchCounts.exact_1 / report.summary.totalWallets).toFixed(1)}%)`);
  console.log(`  <$5 (close):    ${report.summary.matchCounts.close_5.toString().padStart(3)} (${(100 * report.summary.matchCounts.close_5 / report.summary.totalWallets).toFixed(1)}%)`);
  console.log(`  <$10 (close):   ${report.summary.matchCounts.close_10.toString().padStart(3)} (${(100 * report.summary.matchCounts.close_10 / report.summary.totalWallets).toFixed(1)}%)`);
  console.log(`  <20% (moderate): ${report.summary.matchCounts.moderate.toString().padStart(3)} (${(100 * report.summary.matchCounts.moderate / report.summary.totalWallets).toFixed(1)}%)`);
  console.log(`  >20% (large):   ${report.summary.matchCounts.large.toString().padStart(3)} (${(100 * report.summary.matchCounts.large / report.summary.totalWallets).toFixed(1)}%)`);
  console.log(`  Unknown:        ${report.summary.matchCounts.unknown.toString().padStart(3)}`);
  console.log('');

  // Cumulative match rates
  const total = report.summary.successfulFetches;
  const within1 = report.summary.matchCounts.exact_1;
  const within5 = within1 + report.summary.matchCounts.close_5;
  const within10 = within5 + report.summary.matchCounts.close_10;
  console.log('Cumulative Match Rates:');
  console.log(`  Within $1:  ${within1}/${total} (${(100 * within1 / total).toFixed(1)}%)`);
  console.log(`  Within $5:  ${within5}/${total} (${(100 * within5 / total).toFixed(1)}%)`);
  console.log(`  Within $10: ${within10}/${total} (${(100 * within10 / total).toFixed(1)}%)`);
  console.log('');

  if (report.summary.avgDifferenceAbs !== null) {
    console.log(`Average absolute difference: $${report.summary.avgDifferenceAbs.toFixed(2)}`);
  }
  if (report.summary.avgDifferencePct !== null) {
    console.log(`Average percentage difference: ${report.summary.avgDifferencePct.toFixed(1)}%`);
  }
  console.log('');

  // Print detailed results
  console.log('DETAILED RESULTS');
  console.log('-'.repeat(110));
  console.log('Wallet                                   | V29 Realized | UI P/L      | Diff       | Events | Match');
  console.log('-'.repeat(110));

  for (const r of report.results) {
    const v29 = `$${r.v29RealizedPnL.toFixed(2)}`.padStart(12);
    const ui = r.uiProfitLoss !== null ? `$${r.uiProfitLoss.toFixed(2)}`.padStart(11) : 'N/A'.padStart(11);
    const diff = r.differenceAbs !== null ? `$${r.differenceAbs.toFixed(2)}`.padStart(10) : 'N/A'.padStart(10);
    const events = r.v29Events.toString().padStart(6);
    const match = r.matchLevel.padEnd(10);

    console.log(`${r.wallet} | ${v29} | ${ui} | ${diff} | ${events} | ${match}`);
  }
  console.log('');

  // Print worst wallets for debugging
  if (report.worstWallets.length > 0) {
    console.log('WORST 5 WALLETS (for investigation)');
    console.log('-'.repeat(80));
    for (const w of report.worstWallets) {
      console.log(`  ${w.wallet}`);
      console.log(`    V29 Realized: $${w.v29RealizedPnL.toFixed(2)}`);
      console.log(`    UI P/L:       $${w.uiProfitLoss?.toFixed(2) ?? 'N/A'}`);
      console.log(`    Difference:   $${w.differenceAbs?.toFixed(2) ?? 'N/A'}`);
      console.log(`    Events:       ${w.v29Events}`);
      console.log(`    Clamped:      ${w.v29Clamped}`);
      console.log(`    User:         ${w.userName ?? '(none)'}`);
      console.log('');
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('='.repeat(80));
  console.log('V29 REALIZED PNL VS POLYMARKET UI PROFIT/LOSS');
  console.log('='.repeat(80));
  console.log('');
  console.log('Methodology: V29 Realized PnL vs leaderboard.pnl (realized-only comparison)');
  console.log(`Config: limit=${config.limit}`);
  console.log('');

  // Get wallets to test
  let wallets: string[];
  if (config.wallets && config.wallets.length > 0) {
    wallets = config.wallets;
    console.log(`Using specified wallets: ${wallets.length}`);
  } else {
    console.log(`Sampling ${config.limit} wallets from materialized table...`);
    wallets = await sampleWalletsFromTable(config.limit);
    console.log(`  Sampled ${wallets.length} wallets`);
  }
  console.log('');

  // Configure V29 options
  const v29Options: V29Options = {
    inventoryGuard: true,
    useMaterializedTable: true,
  };

  // Run comparisons
  console.log('Running comparisons via Polymarket API...');
  console.log('');

  const results: ComparisonResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    process.stdout.write(`  [${i + 1}/${wallets.length}] ${wallet.slice(0, 16)}...`);

    try {
      const result = await compareWallet(wallet, v29Options);
      results.push(result);

      const matchIcon = result.matchLevel === 'exact_1' || result.matchLevel === 'close_5' || result.matchLevel === 'close_10' ? '✓' : '✗';
      console.log(` ${matchIcon} (V29: $${result.v29RealizedPnL.toFixed(2)}, UI: ${result.uiProfitLoss?.toFixed(2) ?? 'N/A'})`);
    } catch (error: any) {
      console.log(` ERROR: ${error.message.slice(0, 50)}`);
      results.push({
        wallet,
        v29RealizedPnL: 0,
        v29Events: 0,
        v29Clamped: 0,
        uiProfitLoss: null,
        uiVolume: null,
        uiSource: 'error',
        difference: null,
        differenceAbs: null,
        differencePct: null,
        matchLevel: 'unknown',
        fetchedAt: new Date().toISOString(),
        error: error.message,
      });
    }
  }

  // Generate report
  const report = generateReport(config, results);

  // Print report
  printReport(report);

  // Save report to file
  const tmpDir = path.dirname(config.outputPath);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  fs.writeFileSync(config.outputPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${config.outputPath}`);

  console.log('');
  console.log('=== DONE ===');
}

main().catch(console.error);
