#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * DOME REALIZED VALIDATION HARNESS V1
 * ============================================================================
 *
 * Validates Cascadian's Dome-strict realized PnL against Dome API at scale.
 *
 * Key Metrics:
 * - Coverage: % of wallets where Dome returns non-zero data
 * - Accuracy: % of covered wallets within tolerance
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-dome-realized-v1.ts
 *   npx tsx scripts/pnl/validate-dome-realized-v1.ts --count=500
 *   npx tsx scripts/pnl/validate-dome-realized-v1.ts --tolerance=0.15
 *
 * Output:
 *   - Console report with summary stats
 *   - JSON file at tmp/dome_validation_v1_TIMESTAMP.json
 *   - Markdown report at docs/reports/DOME_VALIDATION_V1_TIMESTAMP.md
 *
 * Terminal: Claude 2
 * Date: 2025-12-09
 */

import * as fs from 'fs';
import {
  calculateDomeStrictRealized,
  compareToDome,
  closeClient as closeDomeStrictClient,
  DomeStrictResult,
  DomeComparisonResult,
} from '../../lib/pnl/realizedPnlDomeStrict';
import { fetchDomeRealizedPnL, clearDomeCache } from '../../lib/pnl/domeClient';
import { createClient } from '@clickhouse/client';
import { CANONICAL_TABLES } from '../../lib/pnl/canonicalTables';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  walletCount: number;
  tolerance: number;
  sampleStrategy: 'mixed' | 'high-volume' | 'random';
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    walletCount: 500,
    tolerance: 0.10,
    sampleStrategy: 'mixed',
  };

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      config.walletCount = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--tolerance=')) {
      config.tolerance = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--strategy=')) {
      config.sampleStrategy = arg.split('=')[1] as Config['sampleStrategy'];
    }
  }

  return config;
}

// ============================================================================
// Wallet Sampling
// ============================================================================

async function sampleWallets(count: number, strategy: Config['sampleStrategy']): Promise<string[]> {
  const ch = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
  });

  try {
    let wallets: string[] = [];

    if (strategy === 'mixed') {
      // Get wallets from different volume bins
      const highVolume = await getWalletsByVolume(ch, 100000, Math.floor(count * 0.3));
      const midVolume = await getWalletsByVolume(ch, 10000, Math.floor(count * 0.4), 100000);
      const lowVolume = await getWalletsByVolume(ch, 1000, Math.floor(count * 0.3), 10000);
      wallets = [...highVolume, ...midVolume, ...lowVolume];
    } else if (strategy === 'high-volume') {
      wallets = await getWalletsByVolume(ch, 100000, count);
    } else {
      wallets = await getRandomWallets(ch, count);
    }

    // Dedupe and limit
    wallets = [...new Set(wallets)].slice(0, count);
    return wallets;
  } finally {
    await ch.close();
  }
}

async function getWalletsByVolume(
  ch: any,
  minVolume: number,
  limit: number,
  maxVolume?: number
): Promise<string[]> {
  const maxClause = maxVolume ? `AND abs(sum(usdc_delta)) < ${maxVolume}` : '';

  const query = `
    SELECT wallet_address
    FROM ${CANONICAL_TABLES.UNIFIED_LEDGER_FULL}
    WHERE condition_id != ''
    GROUP BY wallet_address
    HAVING abs(sum(usdc_delta)) >= ${minVolume} ${maxClause}
    ORDER BY rand()
    LIMIT ${limit}
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<{ wallet_address: string }[]>();
  return rows.map(r => r.wallet_address);
}

async function getRandomWallets(ch: any, limit: number): Promise<string[]> {
  const query = `
    SELECT DISTINCT wallet_address
    FROM ${CANONICAL_TABLES.UNIFIED_LEDGER_FULL}
    WHERE condition_id != ''
    ORDER BY rand()
    LIMIT ${limit}
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<{ wallet_address: string }[]>();
  return rows.map(r => r.wallet_address);
}

// ============================================================================
// Validation Logic
// ============================================================================

interface ValidationResult {
  wallet: string;
  cascadian: DomeStrictResult;
  dome: {
    realizedPnl: number | null;
    hasCoverage: boolean;
    isPlaceholder: boolean;
    error?: string;
  };
  comparison: DomeComparisonResult;
}

interface ValidationSummary {
  config: Config;
  timestamp: string;
  walletCount: number;

  // Coverage metrics
  domeHasCoverage: number;
  domeNoCoverage: number;
  coveragePct: number;

  // Accuracy metrics (on covered set only)
  withinTolerance: number;
  outsideTolerance: number;
  accuracyPct: number;

  // Distribution
  avgDelta: number;
  avgDeltaPct: number;
  maxDeltaPct: number;

  // Cascadian stats
  avgCascadianRealized: number;
  totalCascadianRealized: number;

  // Dome stats
  avgDomeRealized: number;
  totalDomeRealized: number;
}

async function runValidation(config: Config): Promise<{
  results: ValidationResult[];
  summary: ValidationSummary;
}> {
  console.log('');
  console.log('='.repeat(80));
  console.log('DOME REALIZED VALIDATION HARNESS V1');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Config:`);
  console.log(`  Wallet count: ${config.walletCount}`);
  console.log(`  Tolerance: ${(config.tolerance * 100).toFixed(1)}%`);
  console.log(`  Sample strategy: ${config.sampleStrategy}`);
  console.log('');

  // Step 1: Sample wallets
  console.log(`Sampling ${config.walletCount} wallets...`);
  const wallets = await sampleWallets(config.walletCount, config.sampleStrategy);
  console.log(`  Got ${wallets.length} wallets`);
  console.log('');

  // Step 2: Calculate and compare
  console.log('Validating against Dome API...');
  const results: ValidationResult[] = [];
  let completed = 0;

  for (const wallet of wallets) {
    // Calculate Cascadian Dome-strict
    const cascadian = await calculateDomeStrictRealized(wallet);

    // Fetch Dome API value
    const domeResult = await fetchDomeRealizedPnL(wallet);
    const domeValue = domeResult.realizedPnl;
    const hasCoverage = domeResult.confidence !== 'none' && !domeResult.isPlaceholder;

    // Compare
    const comparison = compareToDome(cascadian, domeValue, config.tolerance);

    results.push({
      wallet,
      cascadian,
      dome: {
        realizedPnl: domeValue,
        hasCoverage,
        isPlaceholder: domeResult.isPlaceholder,
        error: domeResult.error,
      },
      comparison,
    });

    completed++;
    if (completed % 50 === 0) {
      console.log(`  Processed ${completed}/${wallets.length} wallets`);
    }
  }
  console.log(`  Done. Processed ${completed} wallets.`);
  console.log('');

  // Step 3: Compute summary
  const coveredResults = results.filter(r => r.dome.hasCoverage);
  const withinToleranceResults = coveredResults.filter(r => r.comparison.withinTolerance);

  const summary: ValidationSummary = {
    config,
    timestamp: new Date().toISOString(),
    walletCount: results.length,

    // Coverage
    domeHasCoverage: coveredResults.length,
    domeNoCoverage: results.length - coveredResults.length,
    coveragePct: coveredResults.length / results.length,

    // Accuracy
    withinTolerance: withinToleranceResults.length,
    outsideTolerance: coveredResults.length - withinToleranceResults.length,
    accuracyPct: coveredResults.length > 0
      ? withinToleranceResults.length / coveredResults.length
      : 0,

    // Distribution
    avgDelta: coveredResults.length > 0
      ? coveredResults.reduce((sum, r) => sum + Math.abs(r.comparison.delta || 0), 0) / coveredResults.length
      : 0,
    avgDeltaPct: coveredResults.length > 0
      ? coveredResults.reduce((sum, r) => sum + (r.comparison.deltaPct || 0), 0) / coveredResults.length
      : 0,
    maxDeltaPct: coveredResults.length > 0
      ? Math.max(...coveredResults.map(r => r.comparison.deltaPct || 0))
      : 0,

    // Cascadian
    avgCascadianRealized: results.reduce((sum, r) => sum + r.cascadian.realizedPnl, 0) / results.length,
    totalCascadianRealized: results.reduce((sum, r) => sum + r.cascadian.realizedPnl, 0),

    // Dome (covered only)
    avgDomeRealized: coveredResults.length > 0
      ? coveredResults.reduce((sum, r) => sum + (r.dome.realizedPnl || 0), 0) / coveredResults.length
      : 0,
    totalDomeRealized: coveredResults.reduce((sum, r) => sum + (r.dome.realizedPnl || 0), 0),
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

  console.log('COVERAGE (Dome returns data):');
  console.log(`  Has coverage: ${summary.domeHasCoverage} wallets`);
  console.log(`  No coverage: ${summary.domeNoCoverage} wallets`);
  console.log(`  Coverage %: ${(summary.coveragePct * 100).toFixed(1)}%`);
  console.log('');

  console.log(`ACCURACY (within ${(summary.config.tolerance * 100).toFixed(0)}% tolerance on covered set):`);
  console.log(`  Within tolerance: ${summary.withinTolerance} wallets`);
  console.log(`  Outside tolerance: ${summary.outsideTolerance} wallets`);
  console.log(`  Accuracy %: ${(summary.accuracyPct * 100).toFixed(1)}%`);
  console.log('');

  console.log('DELTA DISTRIBUTION (covered set):');
  console.log(`  Avg delta: $${summary.avgDelta.toFixed(2)}`);
  console.log(`  Avg delta %: ${(summary.avgDeltaPct * 100).toFixed(2)}%`);
  console.log(`  Max delta %: ${(summary.maxDeltaPct * 100).toFixed(2)}%`);
  console.log('');

  console.log('='.repeat(80));
}

function generateMarkdownReport(summary: ValidationSummary, results: ValidationResult[]): string {
  const lines: string[] = [
    '# Dome Realized Validation Report',
    '',
    `> Generated: ${summary.timestamp}`,
    '',
    '---',
    '',
    '## Configuration',
    '',
    `| Parameter | Value |`,
    `|-----------|-------|`,
    `| Wallet count | ${summary.walletCount} |`,
    `| Tolerance | ${(summary.config.tolerance * 100).toFixed(1)}% |`,
    `| Sample strategy | ${summary.config.sampleStrategy} |`,
    '',
    '---',
    '',
    '## Coverage Metrics',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Dome has coverage | ${summary.domeHasCoverage} |`,
    `| Dome no coverage | ${summary.domeNoCoverage} |`,
    `| **Coverage %** | **${(summary.coveragePct * 100).toFixed(1)}%** |`,
    '',
    '---',
    '',
    '## Accuracy Metrics (Covered Set Only)',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Within tolerance | ${summary.withinTolerance} |`,
    `| Outside tolerance | ${summary.outsideTolerance} |`,
    `| **Accuracy %** | **${(summary.accuracyPct * 100).toFixed(1)}%** |`,
    '',
    '---',
    '',
    '## Delta Distribution',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Avg absolute delta | $${summary.avgDelta.toFixed(2)} |`,
    `| Avg delta % | ${(summary.avgDeltaPct * 100).toFixed(2)}% |`,
    `| Max delta % | ${(summary.maxDeltaPct * 100).toFixed(2)}% |`,
    '',
    '---',
    '',
    '## Worst Mismatches (Top 10)',
    '',
    '| Wallet | Cascadian | Dome | Delta % |',
    '|--------|-----------|------|---------|',
  ];

  // Add worst mismatches
  const coveredSorted = results
    .filter(r => r.dome.hasCoverage)
    .sort((a, b) => (b.comparison.deltaPct || 0) - (a.comparison.deltaPct || 0))
    .slice(0, 10);

  for (const r of coveredSorted) {
    lines.push(
      `| ${r.wallet.slice(0, 10)}... | $${r.cascadian.realizedPnl.toFixed(2)} | $${r.dome.realizedPnl?.toFixed(2) || 'N/A'} | ${((r.comparison.deltaPct || 0) * 100).toFixed(1)}% |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Generated by validate-dome-realized-v1.ts*');

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
    const jsonPath = `tmp/dome_validation_v1_${timestamp}.json`;
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2));
    console.log(`JSON saved to: ${jsonPath}`);

    // Save Markdown
    const mdPath = `docs/reports/DOME_VALIDATION_V1_${timestamp}.md`;
    const mdContent = generateMarkdownReport(summary, results);
    fs.writeFileSync(mdPath, mdContent);
    console.log(`Report saved to: ${mdPath}`);

  } finally {
    await closeDomeStrictClient();
    clearDomeCache();
  }
}

main().catch(console.error);
