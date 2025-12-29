#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * FETCH DOME REALIZED PNL SNAPSHOT
 * ============================================================================
 *
 * Fetches realized PnL from Dome API for a list of wallets.
 * Outputs a timestamped JSON snapshot for validation comparisons.
 *
 * ENVIRONMENT VARIABLES:
 * - DOME_API_KEY: Required. Dome API bearer token.
 *
 * USAGE:
 *   # Single wallet test
 *   npx tsx scripts/pnl/fetch-dome-realized-pnl.ts \
 *     --wallet=0xd69be738370bc835e854a447f2a8d96619f91ed8
 *
 *   # Batch mode with concurrency
 *   npx tsx scripts/pnl/fetch-dome-realized-pnl.ts \
 *     --wallets-file=tmp/trader_strict_sample_v2_fast.json \
 *     --limit=50 \
 *     --concurrency=5 \
 *     --output=tmp/dome_realized_snapshot_2025_12_07.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs/promises';
import path from 'path';
import { fetchDomeRealizedPnL, type DomeRealizedResult } from '../../lib/pnl/domeClient';

// ============================================================================
// Types
// ============================================================================

interface SnapshotData {
  metadata: {
    source: 'dome_api';
    fetched_at: string;
    total_wallets: number;
    successful: number;
    failed: number;
  };
  wallets: DomeRealizedResult[];
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
    walletsFile: args.get('wallets-file'),
    wallet: args.get('wallet'),
    limit: Number(args.get('limit') ?? 999),
    concurrency: Number(args.get('concurrency') ?? 5),
    output: args.get('output'),
  };
}

// ============================================================================
// Wallet Loading
// ============================================================================

async function loadWallets(config: ReturnType<typeof parseArgs>): Promise<string[]> {
  if (config.wallet) {
    return [config.wallet.toLowerCase()];
  }

  if (!config.walletsFile) {
    throw new Error('Must provide --wallets-file or --wallet');
  }

  const fullPath = path.join(process.cwd(), config.walletsFile);
  const raw = await fs.readFile(fullPath, 'utf8');
  const data = JSON.parse(raw);

  let candidates: any[] = [];
  if (Array.isArray(data)) {
    candidates = data;
  } else if (Array.isArray(data.wallets)) {
    candidates = data.wallets;
  } else {
    throw new Error(`Unknown wallet file format: ${config.walletsFile}`);
  }

  const wallets = candidates
    .slice(0, config.limit)
    .map(c => {
      if (typeof c === 'string') return c.toLowerCase();
      if (c.wallet_address) return c.wallet_address.toLowerCase();
      if (c.wallet) return c.wallet.toLowerCase();
      throw new Error('Cannot extract wallet address from candidate');
    });

  return wallets;
}

// ============================================================================
// Concurrent Processing
// ============================================================================

async function processWalletBatch(
  wallets: string[],
  concurrency: number
): Promise<DomeRealizedResult[]> {
  const results: DomeRealizedResult[] = [];
  let completed = 0;

  // Process wallets in batches
  for (let i = 0; i < wallets.length; i += concurrency) {
    const batch = wallets.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (wallet, idx) => {
        console.log(`[${i + idx + 1}/${wallets.length}] Fetching ${wallet}...`);
        const result = await fetchDomeRealizedPnL(wallet);

        if (result.error) {
          console.log(`   ❌ Error: ${result.error}`);
        } else {
          console.log(`   ✅ Realized PnL: $${result.realizedPnl?.toLocaleString() ?? 'N/A'}`);
        }

        return result;
      })
    );

    results.push(...batchResults);
    completed += batch.length;

    // Progress indicator
    const success = results.filter(r => !r.error).length;
    const fail = results.filter(r => r.error).length;
    console.log(`\n   Progress: ${completed}/${wallets.length} | Success: ${success} | Failed: ${fail}\n`);
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   FETCH DOME REALIZED PNL SNAPSHOT`);
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Wallets file:    ${config.walletsFile || 'N/A'}`);
  console.log(`   Single wallet:   ${config.wallet || 'N/A'}`);
  console.log(`   Limit:           ${config.limit}`);
  console.log(`   Concurrency:     ${config.concurrency}`);
  console.log(`   Output:          ${config.output || 'auto-generated'}`);
  console.log(`   Start time:      ${new Date().toISOString()}`);
  console.log();

  // Verify API key is set
  if (!process.env.DOME_API_KEY) {
    console.error(`❌ ERROR: DOME_API_KEY environment variable not set`);
    console.error(`   Please set it before running this script.`);
    process.exit(1);
  }

  // Load wallets
  const wallets = await loadWallets(config);
  console.log(`✅ Loaded ${wallets.length} wallets\n`);

  // Process wallets with concurrency
  console.log(`🚀 Fetching realized PnL from Dome API (concurrency=${config.concurrency})...\n`);
  const results = await processWalletBatch(wallets, config.concurrency);

  // Generate snapshot
  const snapshot: SnapshotData = {
    metadata: {
      source: 'dome_api',
      fetched_at: new Date().toISOString(),
      total_wallets: results.length,
      successful: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
    },
    wallets: results,
  };

  // Save snapshot
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  const outputPath = config.output || path.join(
    process.cwd(),
    'tmp',
    `dome_realized_snapshot_${dateStr}.json`
  );

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(outputPath, JSON.stringify(snapshot, null, 2));

  // Summary
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`                    SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total wallets:    ${snapshot.metadata.total_wallets}`);
  console.log(`  Successful:       ${snapshot.metadata.successful} (${((snapshot.metadata.successful / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log(`  Failed:           ${snapshot.metadata.failed} (${((snapshot.metadata.failed / snapshot.metadata.total_wallets) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`📄 Snapshot saved to: ${outputPath}`);
  console.log();

  const failures = results.filter(r => r.error);
  if (failures.length > 0) {
    console.log(`⚠️  Failed wallets:`);
    failures.forEach(r => {
      console.log(`   - ${r.wallet}: ${r.error}`);
    });
    console.log();
  }

  console.log(`═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
