#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * CLASSIFY DOME COVERAGE
 * ============================================================================
 *
 * Analyzes Dome snapshot files and classifies wallets by coverage quality.
 *
 * USAGE:
 *   npx tsx scripts/pnl/classify-dome-coverage.ts \
 *     --snapshot=tmp/dome_realized_big_20_2025_12_07.json \
 *     --output=tmp/dome_coverage_big_20_2025_12_07.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

interface DomeWallet {
  wallet: string;
  realizedPnl: number | null;
  confidence: 'high' | 'low' | 'none';
  isPlaceholder: boolean;
  raw?: any;
  error?: string;
}

interface DomeSnapshot {
  metadata: {
    source: string;
    fetched_at: string;
    total_wallets: number;
    successful: number;
    failed: number;
  };
  wallets: DomeWallet[];
}

interface CoverageReport {
  metadata: {
    source_snapshot: string;
    analyzed_at: string;
    total_wallets: number;
  };
  summary: {
    high_confidence: number;
    low_confidence: number;
    no_confidence: number;
    placeholders: number;
    errors: number;
  };
  reliable_wallets: string[];
  placeholder_wallets: string[];
  error_wallets: string[];
  details: Array<{
    wallet: string;
    realizedPnl: number | null;
    confidence: 'high' | 'low' | 'none';
    isPlaceholder: boolean;
    category: 'reliable' | 'placeholder' | 'error';
  }>;
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
    snapshot: args.get('snapshot'),
    output: args.get('output'),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  if (!config.snapshot) {
    console.error('❌ ERROR: --snapshot parameter required');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   CLASSIFY DOME COVERAGE`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`📄 Input:  ${config.snapshot}`);
  console.log(`📄 Output: ${config.output || 'auto-generated'}\n`);

  // Load snapshot
  const snapshotPath = path.join(process.cwd(), config.snapshot);
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const snapshot: DomeSnapshot = JSON.parse(raw);

  console.log(`✅ Loaded ${snapshot.wallets.length} wallets from snapshot\n`);

  // Classify wallets
  const reliableWallets: string[] = [];
  const placeholderWallets: string[] = [];
  const errorWallets: string[] = [];
  const details: CoverageReport['details'] = [];

  let highConfidence = 0;
  let lowConfidence = 0;
  let noConfidence = 0;
  let placeholders = 0;
  let errors = 0;

  for (const wallet of snapshot.wallets) {
    let category: 'reliable' | 'placeholder' | 'error';

    if (wallet.error && wallet.isPlaceholder) {
      category = 'placeholder';
      placeholderWallets.push(wallet.wallet);
      placeholders++;
      noConfidence++;
    } else if (wallet.error) {
      category = 'error';
      errorWallets.push(wallet.wallet);
      errors++;
      noConfidence++;
    } else if (wallet.confidence === 'high') {
      category = 'reliable';
      reliableWallets.push(wallet.wallet);
      highConfidence++;
    } else if (wallet.confidence === 'low') {
      category = 'reliable'; // Still usable, just zero PnL
      reliableWallets.push(wallet.wallet);
      lowConfidence++;
    } else {
      category = 'error';
      errorWallets.push(wallet.wallet);
      noConfidence++;
    }

    details.push({
      wallet: wallet.wallet,
      realizedPnl: wallet.realizedPnl,
      confidence: wallet.confidence,
      isPlaceholder: wallet.isPlaceholder,
      category,
    });
  }

  // Generate report
  const report: CoverageReport = {
    metadata: {
      source_snapshot: config.snapshot,
      analyzed_at: new Date().toISOString(),
      total_wallets: snapshot.wallets.length,
    },
    summary: {
      high_confidence: highConfidence,
      low_confidence: lowConfidence,
      no_confidence: noConfidence,
      placeholders,
      errors,
    },
    reliable_wallets: reliableWallets,
    placeholder_wallets: placeholderWallets,
    error_wallets: errorWallets,
    details,
  };

  // Save report
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  const outputPath = config.output || path.join(
    process.cwd(),
    'tmp',
    `dome_coverage_report_${dateStr}.json`
  );

  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

  // Summary
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`                    COVERAGE SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total wallets:       ${report.metadata.total_wallets}`);
  console.log(`  High confidence:     ${report.summary.high_confidence} (${((highConfidence / snapshot.wallets.length) * 100).toFixed(1)}%)`);
  console.log(`  Low confidence:      ${report.summary.low_confidence} (${((lowConfidence / snapshot.wallets.length) * 100).toFixed(1)}%)`);
  console.log(`  No confidence:       ${report.summary.no_confidence} (${((noConfidence / snapshot.wallets.length) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`  Reliable:            ${reliableWallets.length} (${((reliableWallets.length / snapshot.wallets.length) * 100).toFixed(1)}%)`);
  console.log(`  Placeholders:        ${placeholderWallets.length} (${((placeholders / snapshot.wallets.length) * 100).toFixed(1)}%)`);
  console.log(`  Errors:              ${errorWallets.length} (${((errors / snapshot.wallets.length) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`📄 Report saved to: ${outputPath}`);
  console.log();

  if (placeholderWallets.length > 0) {
    console.log(`⚠️  Placeholder wallets (Dome has not processed):`);
    placeholderWallets.slice(0, 5).forEach(w => console.log(`   - ${w}`));
    if (placeholderWallets.length > 5) {
      console.log(`   ... and ${placeholderWallets.length - 5} more`);
    }
    console.log();
  }

  console.log(`═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
