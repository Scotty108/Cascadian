#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * TOTAL PNL VS UI TOOLTIP VALIDATION V2
 * ============================================================================
 *
 * Validates Cascadian's Total PnL (V12 Realized + Unrealized) against UI tooltip.
 *
 * Features:
 * - Reports pass rates at both 10% and 20% tolerances
 * - Small-PnL guard filter (exclude abs(UI PnL) < $1,000)
 * - Comparable filter (unresolved positions <= 5%)
 * - Produces TOTAL_PNL_UI_PARITY_V1.md report
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-total-vs-ui-v2.ts --count=50
 *   npx tsx scripts/pnl/validate-total-vs-ui-v2.ts --count=200
 *
 * Terminal: Claude 2
 * Date: 2025-12-10
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
  walletCount: number;
  smallPnlThreshold: number;
  comparableThreshold: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    walletCount: 50,
    smallPnlThreshold: 1000,
    comparableThreshold: 0.05,
  };

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      config.walletCount = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--small-pnl=')) {
      config.smallPnlThreshold = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--comparable=')) {
      config.comparableThreshold = parseFloat(arg.split('=')[1]);
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
}

async function loadUiTruth(): Promise<Map<string, UiTruthEntry>> {
  const truthMap = new Map<string, UiTruthEntry>();

  const candidates = [
    'tmp/ui_tooltip_truth_tierA_verified_100.json',
    'tmp/gold_clob_ui_truth.json',
    'tmp/ui_tooltip_truth_100.json',
    'tmp/tierA_tooltip_samples.json',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`Loading UI truth from: ${candidate}`);
      const data = JSON.parse(fs.readFileSync(candidate, 'utf-8'));

      const entries = Array.isArray(data) ? data : data.wallets || data.results || [];

      for (const entry of entries) {
        const wallet = (entry.wallet || entry.wallet_address || '').toLowerCase();
        if (!wallet) continue;

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
        });
      }

      console.log(`  Loaded ${truthMap.size} wallets with UI truth`);
      return truthMap;
    }
  }

  console.warn('No UI truth file found!');
  return truthMap;
}

// ============================================================================
// Validation Result Types
// ============================================================================

interface ValidationResult {
  wallet: string;
  cascadianTotal: number;
  uiTotal: number;
  delta: number;
  deltaPct: number;
  within10pct: boolean;
  within20pct: boolean;
  breakdown: {
    realizedPnl: number;
    unrealizedPnl: number;
    openPositions: number;
    unresolvedPct: number;
  };
  flags: {
    isSmallPnl: boolean;
    isComparable: boolean;
  };
}

interface TieredSummary {
  tier: string;
  count: number;
  pass10pct: number;
  pass20pct: number;
  rate10pct: number;
  rate20pct: number;
  avgDeltaPct: number;
}

// ============================================================================
// Main Validation
// ============================================================================

async function runValidation(config: Config): Promise<{
  results: ValidationResult[];
  tiers: TieredSummary[];
}> {
  console.log('');
  console.log('='.repeat(80));
  console.log('TOTAL PNL VS UI VALIDATION V2 (V12 Engine)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet count: ${config.walletCount}`);
  console.log(`Small-PnL threshold: $${config.smallPnlThreshold}`);
  console.log(`Comparable threshold: ${(config.comparableThreshold * 100).toFixed(0)}% unresolved`);
  console.log('');

  // Load UI truth
  const uiTruth = await loadUiTruth();
  if (uiTruth.size === 0) {
    throw new Error('No UI truth data available');
  }

  // Get wallets with truth
  const wallets = Array.from(uiTruth.keys()).slice(0, config.walletCount);
  console.log(`Processing ${wallets.length} wallets with UI truth...`);
  console.log('');

  // Run validation
  const results: ValidationResult[] = [];
  let completed = 0;

  for (const wallet of wallets) {
    const truth = uiTruth.get(wallet)!;

    // Compute Total PnL with V12
    const totalResult = await calculateTotalPnl(wallet);

    // Calculate delta
    const delta = totalResult.totalPnl - truth.netTotal;
    const deltaPct = Math.abs(delta) / Math.max(Math.abs(truth.netTotal), 1);

    // Calculate unresolved % from V12 realized engine
    // V12 tracks unresolved events as a % of total events (not positions)
    const unresolvedPct = totalResult.realized.unresolvedPct / 100; // Convert from % to decimal
    const openPositions = totalResult.unrealized.stats.totalPositions;

    // Flags
    const isSmallPnl = Math.abs(truth.netTotal) < config.smallPnlThreshold;
    const isComparable = unresolvedPct <= config.comparableThreshold;

    results.push({
      wallet,
      cascadianTotal: totalResult.totalPnl,
      uiTotal: truth.netTotal,
      delta,
      deltaPct,
      within10pct: deltaPct <= 0.10,
      within20pct: deltaPct <= 0.20,
      breakdown: {
        realizedPnl: totalResult.breakdown.realizedPnl,
        unrealizedPnl: totalResult.breakdown.unrealizedPnl,
        openPositions: openPositions,
        unresolvedPct,
      },
      flags: {
        isSmallPnl,
        isComparable,
      },
    });

    completed++;
    if (completed % 10 === 0) {
      console.log(`  [${completed}/${wallets.length}] Processed...`);
    }
  }
  console.log(`  Done. Processed ${completed} wallets.`);
  console.log('');

  // Compute tiered summaries
  const tiers = computeTiers(results, config);

  return { results, tiers };
}

function computeTiers(results: ValidationResult[], config: Config): TieredSummary[] {
  const tiers: TieredSummary[] = [];

  // Tier 1: All wallets
  const all = results;
  tiers.push({
    tier: 'All Wallets',
    count: all.length,
    pass10pct: all.filter(r => r.within10pct).length,
    pass20pct: all.filter(r => r.within20pct).length,
    rate10pct: all.length > 0 ? all.filter(r => r.within10pct).length / all.length : 0,
    rate20pct: all.length > 0 ? all.filter(r => r.within20pct).length / all.length : 0,
    avgDeltaPct: all.length > 0 ? all.reduce((s, r) => s + r.deltaPct, 0) / all.length : 0,
  });

  // Tier 2: Comparable only (unresolved <= 5%)
  const comparable = results.filter(r => r.flags.isComparable);
  tiers.push({
    tier: 'Comparable (unresolved ≤5%)',
    count: comparable.length,
    pass10pct: comparable.filter(r => r.within10pct).length,
    pass20pct: comparable.filter(r => r.within20pct).length,
    rate10pct: comparable.length > 0 ? comparable.filter(r => r.within10pct).length / comparable.length : 0,
    rate20pct: comparable.length > 0 ? comparable.filter(r => r.within20pct).length / comparable.length : 0,
    avgDeltaPct: comparable.length > 0 ? comparable.reduce((s, r) => s + r.deltaPct, 0) / comparable.length : 0,
  });

  // Tier 3: Comparable + Small-PnL guard
  const guarded = results.filter(r => r.flags.isComparable && !r.flags.isSmallPnl);
  tiers.push({
    tier: 'Comparable + Small-PnL Guard (≥$1K)',
    count: guarded.length,
    pass10pct: guarded.filter(r => r.within10pct).length,
    pass20pct: guarded.filter(r => r.within20pct).length,
    rate10pct: guarded.length > 0 ? guarded.filter(r => r.within10pct).length / guarded.length : 0,
    rate20pct: guarded.length > 0 ? guarded.filter(r => r.within20pct).length / guarded.length : 0,
    avgDeltaPct: guarded.length > 0 ? guarded.reduce((s, r) => s + r.deltaPct, 0) / guarded.length : 0,
  });

  return tiers;
}

// ============================================================================
// Reporting
// ============================================================================

function printSummary(tiers: TieredSummary[]): void {
  console.log('='.repeat(80));
  console.log('TIERED PASS RATES');
  console.log('='.repeat(80));
  console.log('');

  console.log('| Tier | N | @10% | @20% | Avg Delta |');
  console.log('|------|---|------|------|-----------|');
  for (const tier of tiers) {
    console.log(
      `| ${tier.tier.padEnd(35)} | ${tier.count.toString().padStart(3)} | ${(tier.rate10pct * 100).toFixed(1).padStart(4)}% | ${(tier.rate20pct * 100).toFixed(1).padStart(4)}% | ${(tier.avgDeltaPct * 100).toFixed(1).padStart(5)}% |`
    );
  }
  console.log('');
  console.log('='.repeat(80));
}

function generateConsolidatedReport(
  tiers: TieredSummary[],
  results: ValidationResult[],
  config: Config
): string {
  const timestamp = new Date().toISOString();
  const primaryTier = tiers[2]; // Comparable + Small-PnL Guard
  const isShipReady = primaryTier.rate20pct >= 0.80;

  const lines: string[] = [
    '# Total PnL UI Parity Report V1',
    '',
    `> **Generated:** ${timestamp}`,
    `> **Engine:** V12 Synthetic Realized + Mark-to-Market Unrealized`,
    `> **Sample Size:** ${config.walletCount} wallets`,
    '',
    '---',
    '',
    '## Executive Summary',
    '',
  ];

  if (isShipReady) {
    lines.push('**Status: RELEASE READY**');
    lines.push('');
    lines.push(`The V12 Total PnL engine achieves **${(primaryTier.rate20pct * 100).toFixed(1)}%** pass rate at 20% tolerance`);
    lines.push('on Tier A Comparable wallets with the small-PnL guard applied.');
    lines.push('');
    lines.push('This meets the 80% threshold for shipping.');
  } else {
    lines.push('**Status: NEEDS IMPROVEMENT**');
    lines.push('');
    lines.push(`Current pass rate: **${(primaryTier.rate20pct * 100).toFixed(1)}%** at 20% tolerance.`);
    lines.push('Target: 80%.');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Tiered Pass Rates');
  lines.push('');
  lines.push('| Tier | N | @10% | @20% | Avg Delta |');
  lines.push('|------|---|------|------|-----------|');
  for (const tier of tiers) {
    lines.push(
      `| ${tier.tier} | ${tier.count} | **${(tier.rate10pct * 100).toFixed(1)}%** | **${(tier.rate20pct * 100).toFixed(1)}%** | ${(tier.avgDeltaPct * 100).toFixed(1)}% |`
    );
  }

  lines.push('');
  lines.push('**Tier Definitions:**');
  lines.push('- **All Wallets:** Raw results, no filters');
  lines.push('- **Comparable:** Only wallets with ≤5% unresolved positions');
  lines.push('- **Comparable + Small-PnL Guard:** Comparable tier excluding wallets with |UI PnL| < $1,000');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Pass Rate Breakdown');
  lines.push('');

  // Passes at each tolerance
  const comparable = results.filter(r => r.flags.isComparable && !r.flags.isSmallPnl);
  const pass10 = comparable.filter(r => r.within10pct);
  const pass20 = comparable.filter(r => r.within20pct);
  const fail20 = comparable.filter(r => !r.within20pct);

  lines.push(`### At 10% Tolerance: ${pass10.length}/${comparable.length} (${(pass10.length / comparable.length * 100).toFixed(1)}%)`);
  lines.push(`### At 20% Tolerance: ${pass20.length}/${comparable.length} (${(pass20.length / comparable.length * 100).toFixed(1)}%)`);
  lines.push('');

  // Failure analysis
  if (fail20.length > 0) {
    lines.push('### Failures (>20% delta)');
    lines.push('');
    lines.push('| Wallet | Cascadian | UI | Delta % | Open Pos |');
    lines.push('|--------|-----------|-----|---------|----------|');

    const sortedFails = [...fail20].sort((a, b) => b.deltaPct - a.deltaPct);
    for (const r of sortedFails.slice(0, 10)) {
      lines.push(
        `| ${r.wallet.slice(0, 10)}... | $${r.cascadianTotal.toFixed(0)} | $${r.uiTotal.toFixed(0)} | ${(r.deltaPct * 100).toFixed(1)}% | ${r.breakdown.openPositions} |`
      );
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Component Analysis');
  lines.push('');

  const avgRealized = results.reduce((s, r) => s + r.breakdown.realizedPnl, 0) / results.length;
  const avgUnrealized = results.reduce((s, r) => s + r.breakdown.unrealizedPnl, 0) / results.length;
  const avgPositions = results.reduce((s, r) => s + r.breakdown.openPositions, 0) / results.length;

  lines.push('| Component | Average |');
  lines.push('|-----------|---------|');
  lines.push(`| V12 Realized PnL | $${avgRealized.toFixed(2)} |`);
  lines.push(`| Mark-to-Market Unrealized | $${avgUnrealized.toFixed(2)} |`);
  lines.push(`| Open Positions | ${avgPositions.toFixed(1)} |`);

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('**Formula:**');
  lines.push('```');
  lines.push('total_pnl = v12_realized + unrealized_mtm');
  lines.push('```');
  lines.push('');
  lines.push('Where:');
  lines.push('- **v12_realized:** Trade-level realized PnL from V12 engine (CLOB + CTF events)');
  lines.push('- **unrealized_mtm:** Mark-to-market value of open positions using Gamma API prices');
  lines.push('');
  lines.push('**Comparison:**');
  lines.push('- UI truth: Polymarket profile tooltip "Net Total" value');
  lines.push('- Tolerance: Percentage difference relative to UI value');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Conclusion');
  lines.push('');

  if (isShipReady) {
    lines.push('The Total PnL engine is **ready for production use** on Tier A Comparable wallets.');
    lines.push('');
    lines.push('**Recommendations:**');
    lines.push('1. Ship leaderboard with V12-based Total PnL');
    lines.push('2. Apply comparability gates (unresolved ≤5%, |PnL| ≥$1K)');
    lines.push('3. Continue improving accuracy for Tier B/X wallets in Phase 2');
  } else {
    lines.push('Additional work needed to reach 80% threshold.');
    lines.push('');
    lines.push('**Investigation areas:**');
    lines.push('1. Analyze high-delta failures for systematic issues');
    lines.push('2. Review price fetching accuracy');
    lines.push('3. Check for missing trade types');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Generated by validate-total-vs-ui-v2.ts*');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  try {
    const { results, tiers } = await runValidation(config);

    // Print summary
    printSummary(tiers);

    // Save JSON
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const jsonPath = `tmp/total_vs_ui_v2_${config.walletCount}_${timestamp}.json`;
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ tiers, results, config }, null, 2));
    console.log(`JSON saved to: ${jsonPath}`);

    // Save consolidated report
    const mdContent = generateConsolidatedReport(tiers, results, config);
    const mdPath = 'docs/reports/TOTAL_PNL_UI_PARITY_V1.md';
    fs.writeFileSync(mdPath, mdContent);
    console.log(`Report saved to: ${mdPath}`);
    console.log('');

    // Final verdict
    const primaryTier = tiers[2];
    if (primaryTier.rate20pct >= 0.80) {
      console.log('*** RELEASE READY: Pass rate >= 80% at 20% tolerance ***');
    } else {
      console.log(`*** NOT READY: Pass rate ${(primaryTier.rate20pct * 100).toFixed(1)}% < 80% ***`);
    }

  } finally {
    await closeAllClients();
  }
}

main().catch(console.error);
