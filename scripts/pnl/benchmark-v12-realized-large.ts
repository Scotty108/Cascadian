#!/usr/bin/env npx tsx
/**
 * V12 LARGE SCALE REALIZED PNL BENCHMARK (Standardized)
 * ============================================================================
 *
 * PURPOSE: Production-grade harness for benchmarking V11/V12 realized PnL
 * against UI truth sets and Dome API.
 *
 * FORMULA (V11 CANONICAL - "Synthetic Realized"):
 *   - Realizes PnL when a market resolves to 0 or 1
 *   - Does NOT require redemption to count as realized
 *   - This is Cascadian's product definition
 *
 * ROOT CAUSES FIXED:
 *   1. V9 dedup table incompleteness (~11% missing events)
 *      FIX: Source from pm_trader_events_v2 with query-time GROUP BY event_id
 *   2. Empty string payout_numerators treated as resolved
 *      FIX: Added AND res.payout_numerators != ''
 *
 * USAGE:
 *   npx tsx scripts/pnl/benchmark-v12-realized-large.ts \
 *     --wallets-file=tmp/trader_strict_sample_500.json \
 *     --limit=500 \
 *     --output=tmp/v12_benchmark_results.json \
 *     [--ui-truth-file=tmp/apples_v3_maker_only_nodrop.json] \
 *     [--dome-snapshot=tmp/dome_realized_500.json]
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  walletsFile: string;
  limit: number;
  output: string;
  uiTruthFile?: string;
  domeSnapshot?: string;
  concurrency: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let walletsFile = '';
  let limit = 100;
  let output = '';
  let uiTruthFile: string | undefined;
  let domeSnapshot: string | undefined;
  let concurrency = 5;

  for (const arg of args) {
    if (arg.startsWith('--wallets-file=')) {
      walletsFile = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10) || 100;
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    } else if (arg.startsWith('--ui-truth-file=')) {
      uiTruthFile = arg.split('=')[1];
    } else if (arg.startsWith('--dome-snapshot=')) {
      domeSnapshot = arg.split('=')[1];
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1], 10) || 5;
    }
  }

  if (!walletsFile) {
    console.error('ERROR: --wallets-file required');
    console.error('USAGE: npx tsx scripts/pnl/benchmark-v12-realized-large.ts --wallets-file=<path> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --limit=N              Max wallets to process (default: 100)');
    console.error('  --output=<path>        Output JSON file');
    console.error('  --ui-truth-file=<path> UI truth dataset for comparison');
    console.error('  --dome-snapshot=<path> Dome API snapshot for comparison');
    console.error('  --concurrency=N        Parallel queries (default: 5)');
    process.exit(1);
  }

  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  if (!output) {
    output = `tmp/v12_benchmark_${dateStr}.json`;
  }

  return { walletsFile, limit, output, uiTruthFile, domeSnapshot, concurrency };
}

// ============================================================================
// Types
// ============================================================================

interface WalletResult {
  wallet: string;
  v12_realized_pnl: number;     // Cascadian synthetic realized
  event_count: number;
  resolved_events: number;
  unresolved_events: number;
  unresolved_pct: number;
  unresolved_usdc_spent: number;

  // Comparison fields (when available)
  ui_truth_pnl?: number;
  ui_error_pct?: number;
  ui_pass?: boolean;

  dome_realized?: number;
  dome_error_pct?: number;
  dome_pass?: boolean;

  is_comparable: boolean;  // true if unresolved_pct < 50%
  error?: string;
}

interface BenchmarkStats {
  total_wallets: number;
  successful_wallets: number;
  failed_wallets: number;

  // Unresolved distribution
  median_unresolved_pct: number;
  avg_unresolved_pct: number;
  wallets_over_50pct_unresolved: number;

  // Pass rates vs UI truth (if available)
  ui_truth_available: boolean;
  ui_raw_pass_rate?: number;
  ui_comparable_pass_rate?: number;

  // Pass rates vs Dome (if available)
  dome_available: boolean;
  dome_raw_pass_rate?: number;
  dome_comparable_pass_rate?: number;
  dome_overlap_count?: number;

  // Comparable wallet stats
  comparable_wallets: number;
}

// ============================================================================
// ClickHouse Client
// ============================================================================

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000,
});

// ============================================================================
// V11/V12 Realized PnL Calculation (Canonical - Synthetic Realized)
// ============================================================================

async function calculateV12SyntheticRealized(wallet: string): Promise<{
  realized_pnl: number;
  event_count: number;
  resolved_events: number;
  unresolved_events: number;
  unresolved_usdc_spent: number;
}> {
  const q = `
    WITH deduped AS (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
      GROUP BY event_id
    ),
    joined AS (
      SELECT
        te.event_id,
        te.usdc_delta,
        te.token_delta,
        te.role,
        map.outcome_index,
        res.payout_numerators,
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
               toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
          ELSE NULL
        END as payout_norm,
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN 1
          ELSE 0
        END as is_resolved
      FROM deduped AS te
      LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
      LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
      WHERE te.role = 'maker'
    )
    SELECT
      sum(
        CASE
          WHEN payout_norm IS NOT NULL THEN usdc_delta + (token_delta * payout_norm)
          ELSE 0
        END
      ) as realized_pnl,
      count() as event_count,
      sum(is_resolved) as resolved_events,
      sum(1 - is_resolved) as unresolved_events,
      sum(CASE WHEN is_resolved = 0 THEN abs(usdc_delta) ELSE 0 END) as unresolved_usdc_spent
    FROM joined
  `;

  const res = await ch.query({ query: q, format: 'JSONEachRow' });
  const rows = await res.json<any[]>();
  const row = rows[0] || {};

  return {
    realized_pnl: Number(row.realized_pnl || 0),
    event_count: Number(row.event_count || 0),
    resolved_events: Number(row.resolved_events || 0),
    unresolved_events: Number(row.unresolved_events || 0),
    unresolved_usdc_spent: Number(row.unresolved_usdc_spent || 0),
  };
}

// ============================================================================
// Data Loading
// ============================================================================

function loadWallets(config: Config): string[] {
  if (!fs.existsSync(config.walletsFile)) {
    console.error(`ERROR: Wallet file not found: ${config.walletsFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(config.walletsFile, 'utf-8'));
  const wallets: string[] = [];

  if (data.wallets && Array.isArray(data.wallets)) {
    if (typeof data.wallets[0] === 'string') {
      wallets.push(...data.wallets.slice(0, config.limit));
    } else if (data.wallets[0]?.wallet_address) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet_address));
    } else if (data.wallets[0]?.wallet) {
      wallets.push(...data.wallets.slice(0, config.limit).map((w: any) => w.wallet));
    }
  } else if (Array.isArray(data)) {
    const slice = data.slice(0, config.limit);
    for (const item of slice) {
      if (typeof item === 'string') {
        wallets.push(item);
      } else if (item.wallet) {
        wallets.push(item.wallet);
      } else if (item.wallet_address) {
        wallets.push(item.wallet_address);
      }
    }
  }

  return wallets.map(w => w.toLowerCase());
}

function loadUiTruth(path: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!path || !fs.existsSync(path)) return map;

  try {
    const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
    const items = Array.isArray(data) ? data : (data.wallets || data.rows || []);
    for (const item of items) {
      const wallet = (item.wallet || item.wallet_address || '').toLowerCase();
      const pnl = item.uiPnl ?? item.ui_pnl ?? item.pnl;
      if (wallet && pnl !== undefined) {
        map.set(wallet, Number(pnl));
      }
    }
  } catch (e) {
    console.log(`Warning: Could not load UI truth from ${path}`);
  }

  return map;
}

function loadDomeSnapshot(path: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!path || !fs.existsSync(path)) return map;

  try {
    const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
    const items = Array.isArray(data) ? data : (data.wallets || data.rows || []);
    for (const item of items) {
      const wallet = (item.wallet || item.wallet_address || '').toLowerCase();
      const pnl = item.realizedPnl ?? item.realized_pnl ?? item.dome_realized;
      if (wallet && pnl !== undefined) {
        map.set(wallet, Number(pnl));
      }
    }
  } catch (e) {
    console.log(`Warning: Could not load Dome snapshot from ${path}`);
  }

  return map;
}

// ============================================================================
// Statistics
// ============================================================================

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeStats(results: WalletResult[], uiAvailable: boolean, domeAvailable: boolean): BenchmarkStats {
  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  const comparable = successful.filter(r => r.is_comparable);

  const unresolvedPcts = successful.map(r => r.unresolved_pct);

  // UI pass rates
  let uiRawPassRate: number | undefined;
  let uiComparablePassRate: number | undefined;
  if (uiAvailable) {
    const uiComparisons = successful.filter(r => r.ui_truth_pnl !== undefined);
    const uiPasses = uiComparisons.filter(r => r.ui_pass).length;
    uiRawPassRate = uiComparisons.length > 0 ? (uiPasses / uiComparisons.length) * 100 : 0;

    const uiComparableCmp = comparable.filter(r => r.ui_truth_pnl !== undefined);
    const uiComparablePasses = uiComparableCmp.filter(r => r.ui_pass).length;
    uiComparablePassRate = uiComparableCmp.length > 0 ? (uiComparablePasses / uiComparableCmp.length) * 100 : 0;
  }

  // Dome pass rates
  let domeRawPassRate: number | undefined;
  let domeComparablePassRate: number | undefined;
  let domeOverlapCount: number | undefined;
  if (domeAvailable) {
    const domeComparisons = successful.filter(r => r.dome_realized !== undefined);
    domeOverlapCount = domeComparisons.length;
    const domePasses = domeComparisons.filter(r => r.dome_pass).length;
    domeRawPassRate = domeComparisons.length > 0 ? (domePasses / domeComparisons.length) * 100 : 0;

    const domeComparableCmp = comparable.filter(r => r.dome_realized !== undefined);
    const domeComparablePasses = domeComparableCmp.filter(r => r.dome_pass).length;
    domeComparablePassRate = domeComparableCmp.length > 0 ? (domeComparablePasses / domeComparableCmp.length) * 100 : 0;
  }

  return {
    total_wallets: results.length,
    successful_wallets: successful.length,
    failed_wallets: failed.length,
    median_unresolved_pct: median(unresolvedPcts),
    avg_unresolved_pct: unresolvedPcts.length > 0 ? unresolvedPcts.reduce((a, b) => a + b, 0) / unresolvedPcts.length : 0,
    wallets_over_50pct_unresolved: successful.filter(r => r.unresolved_pct >= 50).length,
    comparable_wallets: comparable.length,
    ui_truth_available: uiAvailable,
    ui_raw_pass_rate: uiRawPassRate,
    ui_comparable_pass_rate: uiComparablePassRate,
    dome_available: domeAvailable,
    dome_raw_pass_rate: domeRawPassRate,
    dome_comparable_pass_rate: domeComparablePassRate,
    dome_overlap_count: domeOverlapCount,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log('═'.repeat(100));
  console.log('V12 LARGE SCALE REALIZED PNL BENCHMARK (Standardized)');
  console.log('═'.repeat(100));
  console.log('');
  console.log('METRIC: V12 Synthetic Realized (Cascadian product definition)');
  console.log('  - Realizes PnL when market resolves to 0 or 1');
  console.log('  - Does NOT require redemption');
  console.log('');
  console.log('ROOT CAUSES FIXED:');
  console.log('  1. V9 dedup table incompleteness - use pm_trader_events_v2 with GROUP BY event_id');
  console.log('  2. Empty string payout_numerators - add != \'\' check');
  console.log('');
  console.log('CONFIG:');
  console.log(`  wallets-file: ${config.walletsFile}`);
  console.log(`  limit: ${config.limit}`);
  console.log(`  output: ${config.output}`);
  console.log(`  ui-truth-file: ${config.uiTruthFile || 'none'}`);
  console.log(`  dome-snapshot: ${config.domeSnapshot || 'none'}`);
  console.log('');

  // Load data
  const wallets = loadWallets(config);
  console.log(`Loaded ${wallets.length} wallets`);

  const uiTruth = loadUiTruth(config.uiTruthFile);
  const uiAvailable = uiTruth.size > 0;
  if (uiAvailable) {
    console.log(`Loaded ${uiTruth.size} UI truth entries`);
  }

  const domeMap = loadDomeSnapshot(config.domeSnapshot);
  const domeAvailable = domeMap.size > 0;
  if (domeAvailable) {
    console.log(`Loaded ${domeMap.size} Dome benchmarks`);
  }
  console.log('');

  // Process wallets
  console.log('Processing wallets...');
  console.log('-'.repeat(100));

  const headerParts = ['Wallet          ', 'V12 Realized   ', 'Events  ', 'Unres%'];
  if (uiAvailable) headerParts.push('UI Err  ');
  if (domeAvailable) headerParts.push('Dome Err');
  headerParts.push('Status');
  console.log(headerParts.join(' | '));
  console.log('-'.repeat(100));

  const results: WalletResult[] = [];
  let completed = 0;

  for (const wallet of wallets) {
    try {
      const calc = await calculateV12SyntheticRealized(wallet);
      const unresolvedPct = calc.event_count > 0
        ? (calc.unresolved_events / calc.event_count) * 100
        : 0;

      const isComparable = unresolvedPct < 50;

      // UI comparison
      let uiTruthPnl: number | undefined;
      let uiErrorPct: number | undefined;
      let uiPass: boolean | undefined;
      if (uiTruth.has(wallet)) {
        uiTruthPnl = uiTruth.get(wallet)!;
        const denom = Math.max(Math.abs(uiTruthPnl), 100);
        uiErrorPct = (Math.abs(calc.realized_pnl - uiTruthPnl) / denom) * 100;
        uiPass = uiErrorPct < 5;
      }

      // Dome comparison
      let domeRealized: number | undefined;
      let domeErrorPct: number | undefined;
      let domePass: boolean | undefined;
      if (domeMap.has(wallet)) {
        domeRealized = domeMap.get(wallet)!;
        const denom = Math.max(Math.abs(domeRealized), 100);
        domeErrorPct = (Math.abs(calc.realized_pnl - domeRealized) / denom) * 100;
        domePass = domeErrorPct < 5;
      }

      const result: WalletResult = {
        wallet,
        v12_realized_pnl: Math.round(calc.realized_pnl * 100) / 100,
        event_count: calc.event_count,
        resolved_events: calc.resolved_events,
        unresolved_events: calc.unresolved_events,
        unresolved_pct: Math.round(unresolvedPct * 10) / 10,
        unresolved_usdc_spent: Math.round(calc.unresolved_usdc_spent * 100) / 100,
        ui_truth_pnl: uiTruthPnl,
        ui_error_pct: uiErrorPct !== undefined ? Math.round(uiErrorPct * 100) / 100 : undefined,
        ui_pass: uiPass,
        dome_realized: domeRealized,
        dome_error_pct: domeErrorPct !== undefined ? Math.round(domeErrorPct * 100) / 100 : undefined,
        dome_pass: domePass,
        is_comparable: isComparable,
      };

      results.push(result);

      // Print row
      const shortW = wallet.slice(0, 16);
      const pnlStr = `$${Math.round(calc.realized_pnl).toLocaleString()}`.padStart(14);
      const eventStr = calc.event_count.toString().padStart(7);
      const unresPctStr = `${unresolvedPct.toFixed(1)}%`.padStart(6);

      const rowParts = [shortW, pnlStr, eventStr, unresPctStr];

      if (uiAvailable) {
        rowParts.push(uiErrorPct !== undefined ? `${uiErrorPct.toFixed(1)}%`.padStart(7) : '   N/A ');
      }
      if (domeAvailable) {
        rowParts.push(domeErrorPct !== undefined ? `${domeErrorPct.toFixed(1)}%`.padStart(7) : '   N/A ');
      }

      let status = '-';
      if (!isComparable) {
        status = 'SKIP';
      } else if (uiPass === true || domePass === true) {
        status = '✓';
      } else if (uiPass === false || domePass === false) {
        status = '✗';
      }
      rowParts.push(status);

      console.log(rowParts.join(' | '));

    } catch (err: any) {
      results.push({
        wallet,
        v12_realized_pnl: 0,
        event_count: 0,
        resolved_events: 0,
        unresolved_events: 0,
        unresolved_pct: 0,
        unresolved_usdc_spent: 0,
        is_comparable: false,
        error: err.message,
      });
      console.log(`${wallet.slice(0, 16)} | ERROR: ${err.message}`);
    }

    completed++;
    if (completed % 50 === 0) {
      console.log(`... ${completed}/${wallets.length} complete ...`);
    }
  }

  console.log('-'.repeat(100));
  console.log('');

  // Compute statistics
  const stats = computeStats(results, uiAvailable, domeAvailable);

  // Print summary
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');
  console.log(`Total Wallets: ${stats.total_wallets}`);
  console.log(`  Successful: ${stats.successful_wallets}`);
  console.log(`  Failed: ${stats.failed_wallets}`);
  console.log('');
  console.log(`Unresolved Distribution:`);
  console.log(`  Median: ${stats.median_unresolved_pct.toFixed(1)}%`);
  console.log(`  Average: ${stats.avg_unresolved_pct.toFixed(1)}%`);
  console.log(`  Wallets >50% unresolved: ${stats.wallets_over_50pct_unresolved}`);
  console.log(`  Comparable Wallets (<50% unresolved): ${stats.comparable_wallets}`);
  console.log('');

  if (stats.ui_truth_available) {
    console.log(`Pass Rates vs UI Truth (<5% error):`);
    console.log(`  RAW: ${stats.ui_raw_pass_rate?.toFixed(1)}%`);
    console.log(`  COMPARABLE (<50% unresolved): ${stats.ui_comparable_pass_rate?.toFixed(1)}%`);
    console.log('');
  }

  if (stats.dome_available) {
    console.log(`Pass Rates vs Dome (<5% error):`);
    console.log(`  Overlap: ${stats.dome_overlap_count} wallets`);
    console.log(`  RAW: ${stats.dome_raw_pass_rate?.toFixed(1)}%`);
    console.log(`  COMPARABLE: ${stats.dome_comparable_pass_rate?.toFixed(1)}%`);
    console.log('');
    console.log('NOTE: Dome uses strict cash-realized (sell/redeem only).');
    console.log('      V12 uses synthetic realized (resolve counts without redeem).');
    console.log('      Expect systematic difference for unredeemed winning positions.');
    console.log('');
  }

  // True failures analysis
  const trueFailures = results.filter(r =>
    !r.error &&
    r.is_comparable &&
    r.unresolved_pct < 10 &&
    ((r.ui_error_pct !== undefined && r.ui_error_pct > 5) ||
     (r.dome_error_pct !== undefined && r.dome_error_pct > 5))
  );

  if (trueFailures.length > 0) {
    console.log(`True Failures (<10% unresolved, >5% error): ${trueFailures.length}`);
    console.log('-'.repeat(80));
    for (const r of trueFailures.slice(0, 10)) {
      const uiErrStr = r.ui_error_pct !== undefined ? `UI=${r.ui_error_pct.toFixed(1)}%` : '';
      const domeErrStr = r.dome_error_pct !== undefined ? `Dome=${r.dome_error_pct.toFixed(1)}%` : '';
      console.log(`  ${r.wallet.slice(0, 24)}... | V12=$${r.v12_realized_pnl.toLocaleString()} | ${uiErrStr} ${domeErrStr} | Unres=${r.unresolved_pct}%`);
    }
    console.log('');
  }

  // Save results
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      wallets_file: config.walletsFile,
      ui_truth_file: config.uiTruthFile,
      dome_snapshot: config.domeSnapshot,
      limit: config.limit,
      formula_version: 'V12 Synthetic Realized',
      formula_description: 'Realizes PnL on market resolution, does NOT require redemption',
      root_causes_fixed: [
        'V9 dedup table incompleteness - use pm_trader_events_v2 with GROUP BY event_id',
        'Empty string payout_numerators - add != \'\' check',
      ],
    },
    stats,
    true_failures: trueFailures.map(r => ({
      wallet: r.wallet,
      v12_realized: r.v12_realized_pnl,
      ui_truth: r.ui_truth_pnl,
      dome: r.dome_realized,
      unresolved_pct: r.unresolved_pct,
    })),
    results,
  };

  fs.writeFileSync(config.output, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${config.output}`);
  console.log('');

  await ch.close();
}

main().catch(console.error);
