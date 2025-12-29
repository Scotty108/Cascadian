#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * BUILD DOME TRUTH MAP
 * ============================================================================
 *
 * Creates a merged truth map from multiple Dome snapshots for Terminal 2.
 *
 * USAGE:
 *   npx tsx scripts/pnl/build-dome-truth-map.ts \
 *     --snapshots=tmp/dome_realized_small_20_2025_12_07.json,tmp/dome_realized_big_20_2025_12_07.json \
 *     --output=tmp/dome_truth_map_2025_12_07.json
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
  metadata: any;
  wallets: DomeWallet[];
}

interface TruthMapEntry {
  dome_realized: number | null;
  dome_confidence: 'high' | 'low' | 'none';
  source_snapshot: string;
}

interface TruthMap {
  metadata: {
    generated_at: string;
    source_snapshots: string[];
    total_wallets: number;
    reliable: number;
    unreliable: number;
  };
  wallets: Record<string, TruthMapEntry>;
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
    snapshots: args.get('snapshots')?.split(',') || [],
    output: args.get('output'),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const config = parseArgs();

  if (config.snapshots.length === 0) {
    console.error('❌ ERROR: --snapshots parameter required (comma-separated)');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`   BUILD DOME TRUTH MAP`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`📄 Snapshots: ${config.snapshots.length}`);
  config.snapshots.forEach(s => console.log(`   - ${s}`));
  console.log(`📄 Output:    ${config.output || 'auto-generated'}\n`);

  // Load all snapshots
  const wallets: Record<string, TruthMapEntry> = {};
  const sourceSnapshots: string[] = [];

  for (const snapshotPath of config.snapshots) {
    const fullPath = path.join(process.cwd(), snapshotPath);
    const raw = await fs.readFile(fullPath, 'utf8');
    const snapshot: DomeSnapshot = JSON.parse(raw);

    const sourceName = path.basename(snapshotPath, '.json');
    sourceSnapshots.push(sourceName);

    console.log(`✅ Loaded ${snapshot.wallets.length} wallets from ${sourceName}`);

    for (const wallet of snapshot.wallets) {
      wallets[wallet.wallet.toLowerCase()] = {
        dome_realized: wallet.realizedPnl,
        dome_confidence: wallet.confidence,
        source_snapshot: sourceName,
      };
    }
  }

  const totalWallets = Object.keys(wallets).length;
  const reliable = Object.values(wallets).filter(w => w.dome_confidence !== 'none').length;
  const unreliable = totalWallets - reliable;

  // Generate truth map
  const truthMap: TruthMap = {
    metadata: {
      generated_at: new Date().toISOString(),
      source_snapshots: sourceSnapshots,
      total_wallets: totalWallets,
      reliable,
      unreliable,
    },
    wallets,
  };

  // Save
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');
  const outputPath = config.output || path.join(
    process.cwd(),
    'tmp',
    `dome_truth_map_${dateStr}.json`
  );

  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(outputPath, JSON.stringify(truthMap, null, 2));

  // Summary
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`                    TRUTH MAP SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
  console.log(`  Total wallets:    ${totalWallets}`);
  console.log(`  Reliable:         ${reliable} (${((reliable / totalWallets) * 100).toFixed(1)}%)`);
  console.log(`  Unreliable:       ${unreliable} (${((unreliable / totalWallets) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`📄 Truth map saved to: ${outputPath}`);
  console.log(`\n═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
