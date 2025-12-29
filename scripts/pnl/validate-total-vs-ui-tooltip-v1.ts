#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * TOTAL PNL VS UI TOOLTIP VALIDATION V1
 * ============================================================================
 *
 * Validates Cascadian's Total PnL (Realized + Unrealized) against UI tooltip.
 *
 * This is the "measure the same thing" test:
 * - UI shows Total = Realized + Unrealized
 * - We compute Total = Dome-Strict Realized + Mark-to-Market Unrealized
 *
 * Key insight: If this doesn't match, the bug is likely in price selection
 * (midpoint vs last trade vs implied), not in the realized engine.
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-total-vs-ui-tooltip-v1.ts --phase=1
 *   npx tsx scripts/pnl/validate-total-vs-ui-tooltip-v1.ts --phase=2 --tolerance=0.15
 *   npx tsx scripts/pnl/validate-total-vs-ui-tooltip-v1.ts --wallets=tmp/custom_wallets.json
 *
 * Terminal: Claude 2
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import { createClient } from '@clickhouse/client';
import {
  calculateTotalPnl,
  closeAllClients,
  TotalPnlResult,
} from '../../lib/pnl/totalPnlV1';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  phase: 1 | 2 | 3;
  walletCount: number;
  tolerance: number;
  walletsFile?: string;
  uiTruthFile?: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    phase: 1,
    walletCount: 25,
    tolerance: 0.10,
  };

  for (const arg of args) {
    if (arg.startsWith('--phase=')) {
      const phase = parseInt(arg.split('=')[1], 10);
      config.phase = phase as 1 | 2 | 3;
      // Set wallet counts by phase
      if (phase === 1) config.walletCount = 25;
      else if (phase === 2) config.walletCount = 100;
      else if (phase === 3) config.walletCount = 300;
    } else if (arg.startsWith('--tolerance=')) {
      config.tolerance = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--wallets=')) {
      config.walletsFile = arg.split('=')[1];
    } else if (arg.startsWith('--truth=')) {
      config.uiTruthFile = arg.split('=')[1];
    } else if (arg.startsWith('--count=')) {
      config.walletCount = parseInt(arg.split('=')[1], 10);
    }
  }

  return config;
}

// ============================================================================
// UI Truth Loading
// ============================================================================

interface UiTruthEntry {
  wallet: string;
  netTotal: number;
  gain?: number;
  loss?: number;
  scrapedAt?: string;
  identityVerified?: boolean;
}

async function loadUiTruth(file?: string): Promise<Map<string, UiTruthEntry>> {
  const truthMap = new Map<string, UiTruthEntry>();

  // Try to load from specified file or find default
  const candidates = [
    file,
    'tmp/gold_clob_ui_truth.json',
    'tmp/ui_tooltip_truth_100.json',
    'tmp/tierA_tooltip_samples.json',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`Loading UI truth from: ${candidate}`);
      const data = JSON.parse(fs.readFileSync(candidate, 'utf-8'));

      // Handle different formats
      const entries = Array.isArray(data) ? data : data.wallets || data.results || [];

      for (const entry of entries) {
        const wallet = (entry.wallet || entry.wallet_address || '').toLowerCase();
        if (!wallet) continue;

        // Parse net total from various field names (including nested metrics)
        const netTotal =
          entry.netTotal ??
          entry.net_total ??
          entry.uiNetTotal ??
          entry.ui_net_total ??
          entry.totalPnl ??
          entry.metrics?.net_total ??
          entry.metrics?.netTotal ??
          null;

        if (netTotal === null) continue;

        truthMap.set(wallet, {
          wallet,
          netTotal: Number(netTotal),
          gain: entry.gain ?? entry.uiGain ?? entry.metrics?.gain,
          loss: entry.loss ?? entry.uiLoss ?? entry.metrics?.loss,
          scrapedAt: entry.scrapedAt ?? entry.scraped_at ?? entry.timestamp,
          identityVerified: entry.identityVerified ?? entry.identity_verified,
        });
      }

      console.log(`  Loaded ${truthMap.size} wallets with UI truth`);
      return truthMap;
    }
  }

  console.warn('No UI truth file found. Will generate sample wallets.');
  return truthMap;
}

// ============================================================================
// Wallet Sampling
// ============================================================================

async function sampleWallets(count: number, uiTruth: Map<string, UiTruthEntry>): Promise<string[]> {
  // If we have UI truth, use those wallets first
  if (uiTruth.size > 0) {
    const truthWallets = Array.from(uiTruth.keys()).slice(0, count);
    if (truthWallets.length >= count) {
      return truthWallets;
    }
    // If not enough truth wallets, we'll supplement
    console.log(`  Have ${truthWallets.length} truth wallets, need ${count - truthWallets.length} more`);
  }

  // Sample from Tier A wallets
  const ch = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
  });

  try {
    const query = `
      SELECT wallet_address
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE condition_id != ''
      GROUP BY wallet_address
      HAVING
        sum(abs(usdc_delta)) >= 10000
        AND count() >= 20
      ORDER BY rand()
      LIMIT ${count}
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<{ wallet_address: string }[]>();
    return rows.map(r => r.wallet_address.toLowerCase());
  } finally {
    await ch.close();
  }
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
  wallet: string;
  cascadianTotal: number;
  uiTotal: number | null;
  delta: number | null;
  deltaPct: number | null;
  withinTolerance: boolean;
  hasUiTruth: boolean;
  breakdown: {
    realizedPnl: number;
    unrealizedPnl: number;
    openPositions: number;
  };
}

interface ValidationSummary {
  config: Config;
  timestamp: string;
  totalWallets: number;

  // Coverage
  withUiTruth: number;
  withoutUiTruth: number;

  // Accuracy (on UI truth set)
  withinTolerance: number;
  outsideTolerance: number;
  accuracyPct: number;

  // Distribution
  avgDelta: number;
  avgDeltaPct: number;
  maxDeltaPct: number;

  // Breakdown stats
  avgRealized: number;
  avgUnrealized: number;
  avgPositions: number;
}

async function runValidation(config: Config): Promise<{
  results: ValidationResult[];
  summary: ValidationSummary;
}> {
  console.log('');
  console.log('='.repeat(80));
  console.log('TOTAL PNL VS UI TOOLTIP VALIDATION V1');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Phase: ${config.phase}`);
  console.log(`Wallet count: ${config.walletCount}`);
  console.log(`Tolerance: ${(config.tolerance * 100).toFixed(1)}%`);
  console.log('');

  // Load UI truth
  const uiTruth = await loadUiTruth(config.uiTruthFile);

  // Sample wallets
  console.log(`Sampling ${config.walletCount} wallets...`);
  const wallets = await sampleWallets(config.walletCount, uiTruth);
  console.log(`  Got ${wallets.length} wallets`);
  console.log('');

  // Run validation
  console.log('Computing Total PnL and comparing to UI...');
  const results: ValidationResult[] = [];
  let completed = 0;

  for (const wallet of wallets) {
    // Compute Total PnL
    const totalResult = await calculateTotalPnl(wallet);

    // Get UI truth if available
    const truth = uiTruth.get(wallet);
    const uiTotal = truth?.netTotal ?? null;
    const hasUiTruth = uiTotal !== null;

    // Compare
    let delta: number | null = null;
    let deltaPct: number | null = null;
    let withinTolerance = false;

    if (hasUiTruth) {
      delta = totalResult.totalPnl - uiTotal!;
      deltaPct = Math.abs(delta) / Math.max(Math.abs(uiTotal!), 1);
      withinTolerance = deltaPct <= config.tolerance;
    }

    results.push({
      wallet,
      cascadianTotal: totalResult.totalPnl,
      uiTotal,
      delta,
      deltaPct,
      withinTolerance,
      hasUiTruth,
      breakdown: {
        realizedPnl: totalResult.breakdown.realizedPnl,
        unrealizedPnl: totalResult.breakdown.unrealizedPnl,
        openPositions: totalResult.unrealized.stats.totalPositions,
      },
    });

    completed++;
    if (completed % 10 === 0) {
      console.log(`  [${completed}/${wallets.length}] Processed...`);
    }
  }
  console.log(`  Done. Processed ${completed} wallets.`);
  console.log('');

  // Compute summary
  const withTruth = results.filter(r => r.hasUiTruth);
  const withinToleranceResults = withTruth.filter(r => r.withinTolerance);

  const summary: ValidationSummary = {
    config,
    timestamp: new Date().toISOString(),
    totalWallets: results.length,

    // Coverage
    withUiTruth: withTruth.length,
    withoutUiTruth: results.length - withTruth.length,

    // Accuracy
    withinTolerance: withinToleranceResults.length,
    outsideTolerance: withTruth.length - withinToleranceResults.length,
    accuracyPct: withTruth.length > 0
      ? withinToleranceResults.length / withTruth.length
      : 0,

    // Distribution
    avgDelta: withTruth.length > 0
      ? withTruth.reduce((sum, r) => sum + Math.abs(r.delta || 0), 0) / withTruth.length
      : 0,
    avgDeltaPct: withTruth.length > 0
      ? withTruth.reduce((sum, r) => sum + (r.deltaPct || 0), 0) / withTruth.length
      : 0,
    maxDeltaPct: withTruth.length > 0
      ? Math.max(...withTruth.map(r => r.deltaPct || 0))
      : 0,

    // Breakdown stats
    avgRealized: results.reduce((sum, r) => sum + r.breakdown.realizedPnl, 0) / results.length,
    avgUnrealized: results.reduce((sum, r) => sum + r.breakdown.unrealizedPnl, 0) / results.length,
    avgPositions: results.reduce((sum, r) => sum + r.breakdown.openPositions, 0) / results.length,
  };

  return { results, summary };
}

// ============================================================================
// Reporting
// ============================================================================

function printSummary(summary: ValidationSummary): void {
  console.log('='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  console.log('UI TRUTH COVERAGE:');
  console.log(`  With UI truth: ${summary.withUiTruth} wallets`);
  console.log(`  Without UI truth: ${summary.withoutUiTruth} wallets`);
  console.log('');

  console.log(`ACCURACY (within ${(summary.config.tolerance * 100).toFixed(0)}% tolerance):`)
  console.log(`  Within tolerance: ${summary.withinTolerance} wallets`);
  console.log(`  Outside tolerance: ${summary.outsideTolerance} wallets`);
  console.log(`  ★ ACCURACY: ${(summary.accuracyPct * 100).toFixed(1)}% ★`);
  console.log('');

  console.log('DELTA DISTRIBUTION:');
  console.log(`  Avg absolute delta: $${summary.avgDelta.toFixed(2)}`);
  console.log(`  Avg delta %: ${(summary.avgDeltaPct * 100).toFixed(2)}%`);
  console.log(`  Max delta %: ${(summary.maxDeltaPct * 100).toFixed(2)}%`);
  console.log('');

  console.log('PNL BREAKDOWN (averages):');
  console.log(`  Realized: $${summary.avgRealized.toFixed(2)}`);
  console.log(`  Unrealized: $${summary.avgUnrealized.toFixed(2)}`);
  console.log(`  Avg open positions: ${summary.avgPositions.toFixed(1)}`);
  console.log('');

  console.log('='.repeat(80));
}

function generateMarkdownReport(
  summary: ValidationSummary,
  results: ValidationResult[]
): string {
  const lines: string[] = [
    '# Total PnL vs UI Tooltip Validation Report',
    '',
    `> **Generated:** ${summary.timestamp}`,
    `> **Phase:** ${summary.config.phase}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total wallets | ${summary.totalWallets} |`,
    `| With UI truth | ${summary.withUiTruth} |`,
    `| Tolerance | ${(summary.config.tolerance * 100).toFixed(1)}% |`,
    `| **Accuracy** | **${(summary.accuracyPct * 100).toFixed(1)}%** |`,
    '',
    '---',
    '',
    '## Accuracy Breakdown',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Within tolerance | ${summary.withinTolerance} |`,
    `| Outside tolerance | ${summary.outsideTolerance} |`,
    `| Avg delta | $${summary.avgDelta.toFixed(2)} |`,
    `| Avg delta % | ${(summary.avgDeltaPct * 100).toFixed(2)}% |`,
    `| Max delta % | ${(summary.maxDeltaPct * 100).toFixed(2)}% |`,
    '',
    '---',
    '',
    '## PnL Component Analysis',
    '',
    '| Component | Average |',
    '|-----------|---------|',
    `| Realized | $${summary.avgRealized.toFixed(2)} |`,
    `| Unrealized | $${summary.avgUnrealized.toFixed(2)} |`,
    `| Open positions | ${summary.avgPositions.toFixed(1)} |`,
    '',
    '---',
    '',
    '## Results by Wallet',
    '',
    '| Wallet | Cascadian | UI | Delta % | Status |',
    '|--------|-----------|-----|---------|--------|',
  ];

  // Add individual results
  const withTruth = results.filter(r => r.hasUiTruth);
  const sorted = [...withTruth].sort((a, b) => (b.deltaPct || 0) - (a.deltaPct || 0));

  for (const r of sorted.slice(0, 30)) {
    const status = r.withinTolerance ? '✅' : '❌';
    lines.push(
      `| ${r.wallet.slice(0, 12)}... | $${r.cascadianTotal.toFixed(0)} | $${r.uiTotal?.toFixed(0) || 'N/A'} | ${((r.deltaPct || 0) * 100).toFixed(1)}% | ${status} |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');

  if (summary.accuracyPct >= 0.8) {
    lines.push('✅ **PASS**: Total PnL matches UI within tolerance for 80%+ of wallets.');
    lines.push('');
    lines.push('The realized + unrealized calculation aligns with what users see on Polymarket.');
  } else if (summary.accuracyPct >= 0.6) {
    lines.push('⚠️ **PARTIAL**: Moderate alignment with UI tooltip.');
    lines.push('');
    lines.push('Likely issues:');
    lines.push('- Price selection logic (midpoint vs last trade)');
    lines.push('- Timing differences between scrape and calculation');
  } else {
    lines.push('❌ **NEEDS WORK**: Low alignment with UI tooltip.');
    lines.push('');
    lines.push('Investigate:');
    lines.push('1. Price fetching from Gamma API');
    lines.push('2. Position calculation accuracy');
    lines.push('3. UI scraper data quality');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Generated by validate-total-vs-ui-tooltip-v1.ts*');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  try {
    const { results, summary } = await runValidation(config);

    // Print summary
    printSummary(summary);

    // Save JSON
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const jsonPath = `tmp/total_vs_ui_validation_phase${config.phase}_${timestamp}.json`;
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2));
    console.log(`JSON saved to: ${jsonPath}`);

    // Save Markdown
    const mdPath = `docs/reports/TOTAL_VS_UI_VALIDATION_PHASE${config.phase}_${timestamp}.md`;
    const mdContent = generateMarkdownReport(summary, results);
    fs.writeFileSync(mdPath, mdContent);
    console.log(`Report saved to: ${mdPath}`);

  } finally {
    await closeAllClients();
  }
}

main().catch(console.error);
