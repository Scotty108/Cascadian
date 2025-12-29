#!/usr/bin/env npx tsx
/**
 * FILTER TIER A VERIFIED FROM BENCHMARK
 * ============================================================================
 *
 * Generates tierA_verified_wallets_v1.json from the pre-computed benchmark data.
 * Applies the Tier A Verified criteria:
 * 1. Already Tier A (from benchmark)
 * 2. Unresolved percentage <= 5%
 * 3. (Future: tooltip parity validation)
 *
 * Input: tmp/v12_tierA_benchmark_2000_2025_12_09.json
 * Output: tmp/tierA_verified_wallets_v1.json
 *
 * Usage:
 *   npx tsx scripts/pnl/filter-tierA-verified-from-benchmark.ts
 *   npx tsx scripts/pnl/filter-tierA-verified-from-benchmark.ts --threshold=3
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import * as fs from 'fs';

interface BenchmarkResult {
  wallet: string;
  sample_type: string;
  v12_realized_pnl: number;
  event_count: number;
  resolved_events: number;
  unresolved_events: number;
  unresolved_pct: number;
  unresolved_usdc_spent: number;
  is_comparable: boolean;
}

interface BenchmarkFile {
  metadata: {
    generated_at: string;
    formula_version: string;
    sampling: {
      top_by_volume: number;
      random_sample: number;
      total: number;
    };
  };
  stats: {
    total_wallets: number;
    successful: number;
    comparable: number;
    over_50_unresolved: number;
    median_unresolved_pct: number;
    avg_unresolved_pct: number;
    profitable: number;
    unprofitable: number;
    total_pnl: number;
  };
  results: BenchmarkResult[];
}

interface TierAVerifiedWallet {
  wallet_address: string;
  tier: string;
  sample_type: string;
  event_count: number;
  resolved_events: number;
  unresolved_events: number;
  unresolved_pct: number;
  realized_pnl_v12: number;
  profitable: boolean;
}

interface TierAVerifiedOutput {
  metadata: {
    generated_at: string;
    version: string;
    source_benchmark: string;
    criteria: {
      tier: string;
      unresolved_threshold_pct: number;
    };
    description: string;
  };
  summary: {
    total_wallets: number;
    profitable_count: number;
    unprofitable_count: number;
    total_realized_pnl: number;
    avg_unresolved_pct: number;
    median_unresolved_pct: number;
    by_sample_type: {
      top: number;
      random: number;
    };
  };
  wallets: TierAVerifiedWallet[];
}

function parseArgs(): { unresolvedThreshold: number; inputFile: string; outputFile: string } {
  const args = process.argv.slice(2);
  let unresolvedThreshold = 5; // 5% default
  let inputFile = 'tmp/v12_tierA_benchmark_2000_2025_12_09.json';
  let outputFile = 'tmp/tierA_verified_wallets_v1.json';

  for (const arg of args) {
    if (arg.startsWith('--threshold=')) {
      unresolvedThreshold = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--input=')) {
      inputFile = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.split('=')[1];
    }
  }

  return { unresolvedThreshold, inputFile, outputFile };
}

function main() {
  const { unresolvedThreshold, inputFile, outputFile } = parseArgs();

  console.log('═'.repeat(80));
  console.log('TIER A VERIFIED WALLET FILTER');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Source benchmark: ${inputFile}`);
  console.log(`Unresolved threshold: <= ${unresolvedThreshold}%`);
  console.log(`Output file: ${outputFile}`);
  console.log('');

  // Load benchmark data
  if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: Benchmark file not found: ${inputFile}`);
    process.exit(1);
  }

  const benchmark: BenchmarkFile = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  console.log(`Loaded ${benchmark.results.length} wallets from benchmark`);
  console.log('');

  // Filter for Tier A Verified criteria
  const verified = benchmark.results.filter(r => r.unresolved_pct <= unresolvedThreshold);

  console.log(`Filtered to ${verified.length} wallets with unresolved <= ${unresolvedThreshold}%`);
  console.log('');

  // Sort by PnL descending
  verified.sort((a, b) => b.v12_realized_pnl - a.v12_realized_pnl);

  // Calculate stats
  const unresolvedPcts = verified.map(r => r.unresolved_pct).sort((a, b) => a - b);
  const medianIdx = Math.floor(unresolvedPcts.length / 2);
  const medianUnresolvedPct = unresolvedPcts.length > 0
    ? (unresolvedPcts.length % 2 === 0
        ? (unresolvedPcts[medianIdx - 1] + unresolvedPcts[medianIdx]) / 2
        : unresolvedPcts[medianIdx])
    : 0;

  const avgUnresolvedPct = verified.length > 0
    ? verified.reduce((sum, r) => sum + r.unresolved_pct, 0) / verified.length
    : 0;

  const profitableCount = verified.filter(r => r.v12_realized_pnl >= 0).length;
  const unprofitableCount = verified.filter(r => r.v12_realized_pnl < 0).length;
  const totalPnl = verified.reduce((sum, r) => sum + r.v12_realized_pnl, 0);

  const topCount = verified.filter(r => r.sample_type === 'top').length;
  const randomCount = verified.filter(r => r.sample_type === 'random').length;

  // Build output
  const wallets: TierAVerifiedWallet[] = verified.map(r => ({
    wallet_address: r.wallet,
    tier: 'A',
    sample_type: r.sample_type,
    event_count: r.event_count,
    resolved_events: r.resolved_events,
    unresolved_events: r.unresolved_events,
    unresolved_pct: r.unresolved_pct,
    realized_pnl_v12: r.v12_realized_pnl,
    profitable: r.v12_realized_pnl >= 0,
  }));

  const output: TierAVerifiedOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      version: 'v1',
      source_benchmark: inputFile,
      criteria: {
        tier: 'A',
        unresolved_threshold_pct: unresolvedThreshold,
      },
      description: `Tier A Verified wallets: Tier A with unresolved <= ${unresolvedThreshold}%. PnL computed via V12 Synthetic Realized. Tooltip parity pending validation at scale.`,
    },
    summary: {
      total_wallets: wallets.length,
      profitable_count: profitableCount,
      unprofitable_count: unprofitableCount,
      total_realized_pnl: totalPnl,
      avg_unresolved_pct: avgUnresolvedPct,
      median_unresolved_pct: medianUnresolvedPct,
      by_sample_type: {
        top: topCount,
        random: randomCount,
      },
    },
    wallets,
  };

  // Save
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Saved to: ${outputFile}`);
  console.log('');

  // Print summary
  console.log('═'.repeat(80));
  console.log('TIER A VERIFIED SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Total Tier A Verified wallets: ${wallets.length}`);
  console.log(`  From top-volume sample: ${topCount}`);
  console.log(`  From random sample: ${randomCount}`);
  console.log('');
  console.log(`Profitable: ${profitableCount} (${(profitableCount / wallets.length * 100).toFixed(1)}%)`);
  console.log(`Unprofitable: ${unprofitableCount} (${(unprofitableCount / wallets.length * 100).toFixed(1)}%)`);
  console.log(`Total Realized PnL: $${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');
  console.log(`Avg unresolved %: ${avgUnresolvedPct.toFixed(2)}%`);
  console.log(`Median unresolved %: ${medianUnresolvedPct.toFixed(2)}%`);
  console.log('');

  // Distribution breakdown
  console.log('Unresolved % Distribution:');
  console.log('─'.repeat(40));
  const under1 = wallets.filter(w => w.unresolved_pct <= 1).length;
  const under2 = wallets.filter(w => w.unresolved_pct > 1 && w.unresolved_pct <= 2).length;
  const under3 = wallets.filter(w => w.unresolved_pct > 2 && w.unresolved_pct <= 3).length;
  const under4 = wallets.filter(w => w.unresolved_pct > 3 && w.unresolved_pct <= 4).length;
  const under5 = wallets.filter(w => w.unresolved_pct > 4 && w.unresolved_pct <= 5).length;

  console.log(`  0-1%:   ${under1} wallets (${(under1 / wallets.length * 100).toFixed(1)}%)`);
  console.log(`  1-2%:   ${under2} wallets (${(under2 / wallets.length * 100).toFixed(1)}%)`);
  console.log(`  2-3%:   ${under3} wallets (${(under3 / wallets.length * 100).toFixed(1)}%)`);
  console.log(`  3-4%:   ${under4} wallets (${(under4 / wallets.length * 100).toFixed(1)}%)`);
  console.log(`  4-5%:   ${under5} wallets (${(under5 / wallets.length * 100).toFixed(1)}%)`);
  console.log('');

  // Top 10 most profitable
  console.log('Top 10 Most Profitable (Tier A Verified):');
  console.log('─'.repeat(80));
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    const shortWallet = w.wallet_address.slice(0, 10) + '...' + w.wallet_address.slice(-4);
    console.log(
      `${String(i + 1).padStart(2)}. ${shortWallet} | ` +
      `PnL: $${w.realized_pnl_v12.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14)} | ` +
      `Events: ${w.event_count.toLocaleString().padStart(7)} | ` +
      `Unres: ${w.unresolved_pct.toFixed(1)}%`
    );
  }
  console.log('');

  // Bottom 10 (most losses)
  console.log('Bottom 10 (Largest Losses - Tier A Verified):');
  console.log('─'.repeat(80));
  const bottom = [...wallets].slice(-10).reverse();
  for (let i = 0; i < bottom.length; i++) {
    const w = bottom[i];
    const shortWallet = w.wallet_address.slice(0, 10) + '...' + w.wallet_address.slice(-4);
    console.log(
      `${String(i + 1).padStart(2)}. ${shortWallet} | ` +
      `PnL: $${w.realized_pnl_v12.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14)} | ` +
      `Events: ${w.event_count.toLocaleString().padStart(7)} | ` +
      `Unres: ${w.unresolved_pct.toFixed(1)}%`
    );
  }
  console.log('');

  console.log('✅ Tier A Verified wallet list generated successfully');
  console.log('');
  console.log('Definition locked:');
  console.log(`  - Tier A (high CLOB volume >= $100K)`);
  console.log(`  - Unresolved <= ${unresolvedThreshold}%`);
  console.log('  - V12 Synthetic Realized PnL computed');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Scale Playwright scraping to validate tooltip parity at scale');
  console.log('  2. If parity confirmed, add tooltip_validated flag');
  console.log('  3. Use for copy-trading gate activation');
}

main();
