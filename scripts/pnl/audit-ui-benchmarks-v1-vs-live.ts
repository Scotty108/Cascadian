#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * AUDIT UI BENCHMARKS V1 VS LIVE
 * ============================================================================
 *
 * RED ALERT FIX: pm_ui_pnl_benchmarks_v1 has inaccuracies.
 * This script compares V1 benchmark data against live snapshot data
 * to identify and quantify discrepancies.
 *
 * STRATEGY:
 * - Load V1 benchmarks from ClickHouse
 * - Load live snapshot from JSON file (or run fetcher)
 * - Compare matching wallets
 * - Generate audit report with detailed findings
 *
 * USAGE:
 *   # Using existing live snapshot
 *   npx tsx scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts \
 *     --live-snapshot=tmp/ui_pnl_live_snapshot_2025_12_07.json
 *
 *   # Auto-fetch live data
 *   npx tsx scripts/pnl/audit-ui-benchmarks-v1-vs-live.ts \
 *     --wallets-file=tmp/trader_strict_sample_v2_fast.json \
 *     --limit=50
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// ============================================================================
// Types
// ============================================================================

interface LiveSnapshot {
  metadata: {
    source: string;
    fetched_at: string;
    total_wallets: number;
    successful: number;
    failed: number;
    nonexistent: number;
  };
  wallets: {
    wallet: string;
    uiPnL: number | null;
    scrapedAt: string;
    success: boolean;
    error?: string;
    retries: number;
    rawText?: string;
  }[];
}

interface V1Benchmark {
  wallet_address: string;
  ui_pnl_value: number;
  captured_at: string;
}

interface ComparisonResult {
  wallet: string;
  v1_pnl: number | null;
  live_pnl: number | null;
  delta: number | null;
  abs_delta: number | null;
  pct_diff: number | null;
  category: 'EXACT_MATCH' | 'SMALL_DELTA' | 'MODERATE_DELTA' | 'BIG_DELTA' | 'V1_MISSING' | 'LIVE_MISSING' | 'NONEXISTENT';
}

interface AuditReport {
  metadata: {
    audit_date: string;
    v1_source: 'pm_ui_pnl_benchmarks_v1';
    live_source: string;
    total_compared: number;
  };
  summary: {
    exact_match: number;
    small_delta: number;
    moderate_delta: number;
    big_delta: number;
    v1_missing: number;
    live_missing: number;
    nonexistent: number;
  };
  worst_discrepancies: ComparisonResult[];
  all_results: ComparisonResult[];
}

// ============================================================================
// CLI Args
// ============================================================================

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const [k, v] = a.split('=');
    if (k.startsWith('--')) args.set(k.replace(/^--/, ''), v ?? 'true');
  }
  return {
    snapshot: args.get('snapshot') || args.get('live-snapshot'), // Support both flags
    walletsFile: args.get('wallets-file'),
    limit: Number(args.get('limit') ?? 999),
  };
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadLiveSnapshot(snapshotPath: string): Promise<LiveSnapshot> {
  const fullPath = path.join(process.cwd(), snapshotPath);
  const raw = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(raw);
}

async function loadV1Benchmarks(wallets: string[]): Promise<Map<string, number>> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      wallet_address,
      ui_pnl_value
    FROM pm_ui_pnl_benchmarks_v1
    WHERE wallet_address IN (${wallets.map(w => `'${w}'`).join(',')})
    ORDER BY wallet_address
  `;

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });

  const rows = await result.json<V1Benchmark>();
  const benchmarks = new Map<string, number>();

  for (const row of rows) {
    benchmarks.set(row.wallet_address.toLowerCase(), row.ui_pnl_value);
  }

  return benchmarks;
}

// ============================================================================
// Comparison Logic
// ============================================================================

function categorizeComparison(delta: number | null, livePnl: number | null): string {
  if (delta === null) return 'LIVE_MISSING';

  const absDelta = Math.abs(delta);

  if (absDelta < 1) return 'EXACT_MATCH';
  if (absDelta < 10) return 'SMALL_DELTA';
  if (absDelta < 100) return 'MODERATE_DELTA';
  return 'BIG_DELTA';
}

function compareV1VsLive(
  v1Benchmarks: Map<string, number>,
  liveSnapshot: LiveSnapshot
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  for (const liveWallet of liveSnapshot.wallets) {
    const wallet = liveWallet.wallet.toLowerCase();

    // Skip nonexistent profiles
    if (!liveWallet.success && liveWallet.error === 'Profile does not exist (anon)') {
      results.push({
        wallet,
        v1_pnl: v1Benchmarks.get(wallet) ?? null,
        live_pnl: null,
        delta: null,
        abs_delta: null,
        pct_diff: null,
        category: 'NONEXISTENT',
      });
      continue;
    }

    const v1Pnl = v1Benchmarks.get(wallet);
    const livePnl = liveWallet.uiPnL;

    if (v1Pnl === undefined) {
      results.push({
        wallet,
        v1_pnl: null,
        live_pnl: livePnl,
        delta: null,
        abs_delta: null,
        pct_diff: null,
        category: 'V1_MISSING',
      });
      continue;
    }

    if (livePnl === null) {
      results.push({
        wallet,
        v1_pnl: v1Pnl,
        live_pnl: null,
        delta: null,
        abs_delta: null,
        pct_diff: null,
        category: 'LIVE_MISSING',
      });
      continue;
    }

    const delta = v1Pnl - livePnl;
    const absDelta = Math.abs(delta);
    const pctDiff = livePnl !== 0 ? (absDelta / Math.abs(livePnl)) * 100 : null;

    results.push({
      wallet,
      v1_pnl: v1Pnl,
      live_pnl: livePnl,
      delta,
      abs_delta: absDelta,
      pct_diff: pctDiff,
      category: categorizeComparison(delta, livePnl) as any,
    });
  }

  return results;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateAuditReport(
  results: ComparisonResult[],
  liveSource: string
): AuditReport {
  const summary = {
    exact_match: results.filter(r => r.category === 'EXACT_MATCH').length,
    small_delta: results.filter(r => r.category === 'SMALL_DELTA').length,
    moderate_delta: results.filter(r => r.category === 'MODERATE_DELTA').length,
    big_delta: results.filter(r => r.category === 'BIG_DELTA').length,
    v1_missing: results.filter(r => r.category === 'V1_MISSING').length,
    live_missing: results.filter(r => r.category === 'LIVE_MISSING').length,
    nonexistent: results.filter(r => r.category === 'NONEXISTENT').length,
  };

  // Get worst discrepancies (highest abs_delta, excluding nonexistent)
  const worstDiscrepancies = results
    .filter(r => r.abs_delta !== null && r.category !== 'NONEXISTENT')
    .sort((a, b) => (b.abs_delta || 0) - (a.abs_delta || 0))
    .slice(0, 20);

  return {
    metadata: {
      audit_date: new Date().toISOString(),
      v1_source: 'pm_ui_pnl_benchmarks_v1',
      live_source: liveSource,
      total_compared: results.length,
    },
    summary,
    worst_discrepancies: worstDiscrepancies,
    all_results: results,
  };
}

async function writeMarkdownReport(report: AuditReport, outputPath: string) {
  const lines: string[] = [];

  lines.push('# UI Benchmark V1 vs Live Audit Report');
  lines.push('');
  lines.push(`**Date:** ${report.metadata.audit_date.split('T')[0]}`);
  lines.push(`**V1 Source:** ${report.metadata.v1_source}`);
  lines.push(`**Live Source:** ${report.metadata.live_source}`);
  lines.push(`**Total Compared:** ${report.metadata.total_compared}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Category | Count | % |');
  lines.push('|----------|-------|---|');

  const total = report.metadata.total_compared;
  const pct = (count: number) => ((count / total) * 100).toFixed(1);

  lines.push(`| **Exact Match** (<$1) | ${report.summary.exact_match} | ${pct(report.summary.exact_match)}% |`);
  lines.push(`| **Small Delta** ($1-10) | ${report.summary.small_delta} | ${pct(report.summary.small_delta)}% |`);
  lines.push(`| **Moderate Delta** ($10-100) | ${report.summary.moderate_delta} | ${pct(report.summary.moderate_delta)}% |`);
  lines.push(`| **Big Delta** (>$100) | ${report.summary.big_delta} | ${pct(report.summary.big_delta)}% |`);
  lines.push(`| V1 Missing | ${report.summary.v1_missing} | ${pct(report.summary.v1_missing)}% |`);
  lines.push(`| Live Missing (Error) | ${report.summary.live_missing} | ${pct(report.summary.live_missing)}% |`);
  lines.push(`| Nonexistent (Anon+$0) | ${report.summary.nonexistent} | ${pct(report.summary.nonexistent)}% |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Top 20 Worst Discrepancies');
  lines.push('');
  lines.push('| Wallet | V1 PnL | Live PnL | Delta | Abs Delta | % Diff |');
  lines.push('|--------|--------|----------|-------|-----------|--------|');

  for (const r of report.worst_discrepancies) {
    const wallet = r.wallet.slice(0, 12) + '...';
    const v1 = r.v1_pnl !== null ? `$${r.v1_pnl.toLocaleString()}` : 'N/A';
    const live = r.live_pnl !== null ? `$${r.live_pnl.toLocaleString()}` : 'N/A';
    const delta = r.delta !== null ? `$${r.delta.toLocaleString()}` : 'N/A';
    const absDelta = r.abs_delta !== null ? `$${r.abs_delta.toLocaleString()}` : 'N/A';
    const pctDiff = r.pct_diff !== null ? `${r.pct_diff.toFixed(1)}%` : 'N/A';

    lines.push(`| ${wallet} | ${v1} | ${live} | ${delta} | ${absDelta} | ${pctDiff} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');

  const totalValid = total - report.summary.nonexistent - report.summary.live_missing;
  const totalAccurate = report.summary.exact_match + report.summary.small_delta;
  const accuracyPct = ((totalAccurate / totalValid) * 100).toFixed(1);

  lines.push(`**V1 Accuracy:** ${totalAccurate}/${totalValid} wallets (${accuracyPct}%) are within $10 of live truth.`);
  lines.push('');

  if (report.summary.big_delta > 0) {
    lines.push(`**⚠️ Warning:** ${report.summary.big_delta} wallets (${pct(report.summary.big_delta)}%) have >$100 discrepancy.`);
    lines.push('');
  }

  if (report.summary.nonexistent > 0) {
    lines.push(`**Note:** ${report.summary.nonexistent} wallets marked as nonexistent (Anon+$0) are excluded from validation.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');

  if (report.summary.big_delta > 5 || parseFloat(accuracyPct) < 90) {
    lines.push('**🚨 RED ALERT:** V1 benchmark data is significantly inaccurate. Recommend:');
    lines.push('1. Deprecate `pm_ui_pnl_benchmarks_v1` immediately');
    lines.push('2. Create `pm_ui_pnl_benchmarks_v2` with live-fetched data');
    lines.push('3. Update all comparison scripts to use V2 as truth');
  } else {
    lines.push('**✅ V1 benchmarks appear reasonably accurate** for this sample.');
    lines.push('Consider spot-checking the discrepancies before full V2 migration.');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Terminal:** Claude 1`);
  lines.push('');

  await fs.writeFile(outputPath, lines.join('\n'));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   AUDIT UI BENCHMARKS V1 VS LIVE`);
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Snapshot:         ${config.snapshot || 'REQUIRED'}`);
  console.log(`   Wallets file:     ${config.walletsFile || 'N/A'}`);
  console.log(`   Limit:            ${config.limit}`);
  console.log();

  // Load live snapshot
  if (!config.snapshot) {
    throw new Error('--snapshot is required. Please provide path to live snapshot JSON file.');
  }

  console.log(`📂 Loading live snapshot from: ${config.snapshot}`);
  const liveSnapshot = await loadLiveSnapshot(config.snapshot);
  console.log(`✅ Loaded ${liveSnapshot.wallets.length} wallets from live snapshot\n`);

  // Extract wallet addresses
  const wallets = liveSnapshot.wallets.map(w => w.wallet.toLowerCase());

  // Load V1 benchmarks
  console.log(`📂 Loading V1 benchmarks from ClickHouse...`);
  const v1Benchmarks = await loadV1Benchmarks(wallets);
  console.log(`✅ Loaded ${v1Benchmarks.size} V1 benchmarks\n`);

  // Compare
  console.log(`🔍 Comparing V1 vs Live...`);
  const results = compareV1VsLive(v1Benchmarks, liveSnapshot);
  console.log(`✅ Compared ${results.length} wallets\n`);

  // Generate report
  console.log(`📊 Generating audit report...`);
  const report = generateAuditReport(results, config.liveSnapshot || 'auto-fetched');

  // Save JSON report
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const jsonPath = path.join(process.cwd(), 'tmp', `ui_benchmark_audit_v1_${dateStr}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  console.log(`✅ JSON report saved: ${jsonPath}`);

  // Save markdown report
  const mdPath = path.join(
    process.cwd(),
    'docs',
    'reports',
    `UI_BENCHMARK_AUDIT_V1_VS_LIVE_${dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1_$2_$3')}.md`
  );
  await writeMarkdownReport(report, mdPath);
  console.log(`✅ Markdown report saved: ${mdPath}`);

  // Summary
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`                    SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total compared:   ${report.metadata.total_compared}`);
  console.log(`  Exact match:      ${report.summary.exact_match} (${((report.summary.exact_match / report.metadata.total_compared) * 100).toFixed(1)}%)`);
  console.log(`  Small delta:      ${report.summary.small_delta} (${((report.summary.small_delta / report.metadata.total_compared) * 100).toFixed(1)}%)`);
  console.log(`  Moderate delta:   ${report.summary.moderate_delta} (${((report.summary.moderate_delta / report.metadata.total_compared) * 100).toFixed(1)}%)`);
  console.log(`  Big delta:        ${report.summary.big_delta} (${((report.summary.big_delta / report.metadata.total_compared) * 100).toFixed(1)}%)`);
  console.log(`  V1 missing:       ${report.summary.v1_missing}`);
  console.log(`  Live missing:     ${report.summary.live_missing}`);
  console.log(`  Nonexistent:      ${report.summary.nonexistent}`);
  console.log();

  const totalValid = report.metadata.total_compared - report.summary.nonexistent - report.summary.live_missing;
  const totalAccurate = report.summary.exact_match + report.summary.small_delta;
  console.log(`  ✅ V1 Accuracy: ${totalAccurate}/${totalValid} (${((totalAccurate / totalValid) * 100).toFixed(1)}%) within $10 of live truth`);
  console.log();

  if (report.summary.big_delta > 0) {
    const pctWrong = ((report.summary.big_delta / totalValid) * 100).toFixed(1);
    console.log(`  ⚠️  V1 Wrong: ${report.summary.big_delta} wallets (${pctWrong}%) have >$100 discrepancy`);
    console.log();
  }

  console.log(`  📋 Top 5 Largest USD Deltas:`);
  for (let i = 0; i < Math.min(5, report.worst_discrepancies.length); i++) {
    const r = report.worst_discrepancies[i];
    const wallet = r.wallet.slice(0, 12);
    const delta = r.abs_delta !== null ? `$${r.abs_delta.toLocaleString()}` : 'N/A';
    console.log(`     ${i + 1}. ${wallet}... : ${delta}`);
  }
  console.log();

  console.log(`📄 Full report: ${mdPath}`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
