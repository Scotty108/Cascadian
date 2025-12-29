/**
 * Merge Tooltip Truth
 *
 * Merges v1 and v2 tooltip truth datasets, deduplicates by wallet,
 * and writes the combined dataset.
 *
 * Input:
 *   - data/regression/tooltip_truth_v1.json (existing 18 wallets)
 *   - tmp/playwright_tooltip_ground_truth_v2.json (new 30 wallets)
 *
 * Output:
 *   - data/regression/tooltip_truth_v2.json (combined, deduplicated)
 *
 * Usage: npx tsx scripts/pnl/merge-tooltip-truth.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface TooltipWallet {
  wallet: string;
  uiPnl: number;
  gain: number | null;
  loss: number | null;
  volume: number | null;
  scrapedAt: string;
  identityCheckPass: boolean;
  label?: string;
  bin?: string;
  openPositions?: number;
  notes: string;
}

interface TooltipTruthFile {
  metadata: {
    generated_at: string;
    source: string;
    method: string;
    wallet_count: number;
    tolerance_pct: number;
    min_pnl_threshold: number;
  };
  wallets: TooltipWallet[];
  validation_method?: {
    steps: string[];
    why_tooltip: string;
    failure_indicators: string[];
  };
}

async function main() {
  console.log('=== Merge Tooltip Truth Datasets ===\n');

  const v1Path = path.join(process.cwd(), 'data', 'regression', 'tooltip_truth_v1.json');
  const v2Path = path.join(process.cwd(), 'tmp', 'playwright_tooltip_ground_truth_v2.json');
  const outputPath = path.join(process.cwd(), 'data', 'regression', 'tooltip_truth_v2.json');

  // Load v1 (existing)
  let v1Wallets: TooltipWallet[] = [];
  if (fs.existsSync(v1Path)) {
    const v1Data: TooltipTruthFile = JSON.parse(fs.readFileSync(v1Path, 'utf-8'));
    v1Wallets = v1Data.wallets;
    console.log(`Loaded v1: ${v1Wallets.length} wallets from ${v1Path}`);
  } else {
    console.log(`Warning: v1 file not found at ${v1Path}`);
  }

  // Load v2 (new)
  let v2Wallets: TooltipWallet[] = [];
  if (fs.existsSync(v2Path)) {
    const v2Data: TooltipTruthFile = JSON.parse(fs.readFileSync(v2Path, 'utf-8'));
    v2Wallets = v2Data.wallets;
    console.log(`Loaded v2: ${v2Wallets.length} wallets from ${v2Path}`);
  } else {
    console.log(`Warning: v2 file not found at ${v2Path}`);
  }

  if (v1Wallets.length === 0 && v2Wallets.length === 0) {
    console.error('No wallet data found in either file.');
    process.exit(1);
  }

  // Deduplicate by wallet address (v2 takes precedence as it's newer)
  const walletMap = new Map<string, TooltipWallet>();

  // Add v1 first
  for (const w of v1Wallets) {
    walletMap.set(w.wallet.toLowerCase(), w);
  }

  // Add v2 (overwrites duplicates)
  for (const w of v2Wallets) {
    walletMap.set(w.wallet.toLowerCase(), w);
  }

  const mergedWallets = Array.from(walletMap.values());

  // Sort by bin, then by uiPnl descending
  const binOrder = ['0-10', '11-25', '26-50', '51-100', '100+', undefined];
  mergedWallets.sort((a, b) => {
    const binA = a.bin || a.label || '';
    const binB = b.bin || b.label || '';
    const orderA = binOrder.findIndex((b) => b === binA || b === undefined);
    const orderB = binOrder.findIndex((b) => b === binB || b === undefined);
    if (orderA !== orderB) return orderA - orderB;
    return Math.abs(b.uiPnl) - Math.abs(a.uiPnl);
  });

  // Count by bin
  const binCounts: Record<string, number> = {
    '0-10': 0,
    '11-25': 0,
    '26-50': 0,
    '51-100': 0,
    '100+': 0,
    'unknown': 0,
  };

  for (const w of mergedWallets) {
    const bin = w.bin || 'unknown';
    if (bin in binCounts) {
      binCounts[bin]++;
    } else {
      binCounts['unknown']++;
    }
  }

  // Generate output
  const output: TooltipTruthFile = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'playwright_tooltip_verified_merged',
      method:
        'Merged v1 + v2 tooltip truth. Hover info icon, extract Net Total from tooltip. Validate: Gain - Loss = Net Total',
      wallet_count: mergedWallets.length,
      tolerance_pct: 10,
      min_pnl_threshold: 100,
    },
    wallets: mergedWallets,
    validation_method: {
      steps: [
        '1. Navigate to https://polymarket.com/profile/{wallet}',
        '2. Click the ALL button in the P/L timeframe selector',
        '3. Hover the info (i) icon next to Profit/Loss',
        '4. Extract: Volume, Gain, Loss, Net Total from tooltip',
        '5. Verify: Gain - |Loss| = Net Total (identity check)',
        '6. Record validated Net Total as uiPnl',
      ],
      why_tooltip:
        'The tooltip provides a self-check identity (Gain - Loss = Net Total) that proves we scraped the correct value',
      failure_indicators: [
        'PnL equals Positions Value (scraped wrong element)',
        'PnL equals Biggest Win (scraped wrong element)',
        'PnL equals Volume Traded (scraped wrong element)',
        'Net Total != Gain - Loss (data inconsistency)',
      ],
    },
  };

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Summary
  console.log('\n=== MERGE SUMMARY ===\n');
  console.log(`v1 wallets: ${v1Wallets.length}`);
  console.log(`v2 wallets: ${v2Wallets.length}`);

  // Count duplicates
  const v1Set = new Set(v1Wallets.map((w) => w.wallet.toLowerCase()));
  const v2Set = new Set(v2Wallets.map((w) => w.wallet.toLowerCase()));
  const duplicates = [...v1Set].filter((w) => v2Set.has(w));
  console.log(`Duplicates (v2 takes precedence): ${duplicates.length}`);

  console.log(`\nMerged total: ${mergedWallets.length} wallets`);

  console.log('\nBy bin:');
  for (const [bin, count] of Object.entries(binCounts)) {
    if (count > 0) {
      console.log(`  ${bin.padEnd(8)}: ${count}`);
    }
  }

  const passed = mergedWallets.filter((w) => w.identityCheckPass).length;
  console.log(`\nIdentity check: ${passed}/${mergedWallets.length} passed`);

  console.log(`\nOutput written to: ${outputPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
