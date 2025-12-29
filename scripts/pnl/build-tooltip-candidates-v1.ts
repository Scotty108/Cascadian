/**
 * Build Tooltip Candidates V1
 *
 * Queries candidate wallets with meaningful CLOB activity,
 * computes V29 UI mode for each, buckets by openPositions,
 * and selects target counts per bin.
 *
 * Target bins:
 *   0-10:   8 wallets
 *   11-25:  8 wallets
 *   26-50:  8 wallets
 *   51-100: 4 wallets
 *   100+:   2 wallets (control group)
 *
 * Filters:
 *   - eventsProcessed >= 20
 *   - abs(uiParityPnl) >= 200
 *
 * Output: tmp/tooltip_candidates_v1.json
 *
 * Usage: npx tsx scripts/pnl/build-tooltip-candidates-v1.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';
import * as fs from 'fs';
import * as path from 'path';

interface Candidate {
  wallet: string;
  openPositions: number;
  uiParityPnl: number;
  eventsProcessed: number;
  bin: string;
}

interface BinConfig {
  min: number;
  max: number;
  target: number;
}

const BINS: Record<string, BinConfig> = {
  '0-10': { min: 0, max: 10, target: 8 },
  '11-25': { min: 11, max: 25, target: 8 },
  '26-50': { min: 26, max: 50, target: 8 },
  '51-100': { min: 51, max: 100, target: 4 },
  '100+': { min: 101, max: Infinity, target: 2 },
};

const MIN_EVENTS = 20;
const MIN_ABS_PNL = 200;

function getBin(openPositions: number): string {
  if (openPositions <= 10) return '0-10';
  if (openPositions <= 25) return '11-25';
  if (openPositions <= 50) return '26-50';
  if (openPositions <= 100) return '51-100';
  return '100+';
}

async function getCandidateWallets(): Promise<string[]> {
  // Query wallets with moderate trading activity (not dust, not crazy whales)
  // Using CLOB trades as primary filter
  const query = `
    SELECT
      trader_wallet as wallet,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as total_usdc
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY trader_wallet
    HAVING trade_count >= 20
      AND total_usdc BETWEEN 1000 AND 50000000
    ORDER BY total_usdc DESC
    LIMIT 500
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as { wallet: string }[];
  return rows.map((r) => r.wallet.toLowerCase());
}

async function main() {
  console.log('=== Build Tooltip Candidates V1 ===\n');
  console.log('Target bins:');
  for (const [bin, config] of Object.entries(BINS)) {
    console.log(`  ${bin}: ${config.target} wallets`);
  }
  console.log(`\nFilters: eventsProcessed >= ${MIN_EVENTS}, abs(uiParityPnl) >= $${MIN_ABS_PNL}\n`);

  // Get candidate wallets from ClickHouse
  console.log('Fetching candidate wallets from ClickHouse...');
  const wallets = await getCandidateWallets();
  console.log(`Found ${wallets.length} candidate wallets\n`);

  // Track candidates by bin
  const binCandidates: Record<string, Candidate[]> = {
    '0-10': [],
    '11-25': [],
    '26-50': [],
    '51-100': [],
    '100+': [],
  };

  // Check if all bins are full
  const isBinsFull = () =>
    Object.entries(BINS).every(
      ([bin, config]) => binCandidates[bin].length >= config.target
    );

  // Process wallets until bins are full or we run out
  let processed = 0;
  let errors = 0;

  for (const wallet of wallets) {
    if (isBinsFull()) {
      console.log('\nAll bins full!');
      break;
    }

    processed++;
    if (processed % 10 === 0) {
      const counts = Object.entries(binCandidates)
        .map(([bin, arr]) => `${bin}:${arr.length}/${BINS[bin].target}`)
        .join(' | ');
      console.log(`Progress: ${processed}/${wallets.length} | ${counts}`);
    }

    try {
      const v29 = await calculateV29PnL(wallet, {
        inventoryGuard: true,
        valuationMode: 'ui',
      });

      // Apply filters
      if (v29.eventsProcessed < MIN_EVENTS) continue;
      if (Math.abs(v29.uiParityPnl) < MIN_ABS_PNL) continue;

      const bin = getBin(v29.openPositions);

      // Skip if this bin is already full
      if (binCandidates[bin].length >= BINS[bin].target) continue;

      // Add to bin
      binCandidates[bin].push({
        wallet,
        openPositions: v29.openPositions,
        uiParityPnl: v29.uiParityPnl,
        eventsProcessed: v29.eventsProcessed,
        bin,
      });

      console.log(
        `  + ${wallet.slice(0, 12)}... | Bin: ${bin.padEnd(6)} | Pos: ${v29.openPositions.toString().padStart(4)} | PnL: $${Math.round(v29.uiParityPnl).toLocaleString()}`
      );
    } catch (e) {
      errors++;
      // Skip errors silently
    }
  }

  // Generate output
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      filters: {
        min_events: MIN_EVENTS,
        min_abs_pnl: MIN_ABS_PNL,
      },
      bin_targets: BINS,
      wallets_processed: processed,
      errors,
    },
    bins: binCandidates,
    all_candidates: Object.values(binCandidates).flat(),
  };

  // Write output
  const outputPath = path.join(process.cwd(), 'tmp', 'tooltip_candidates_v1.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log('Bin coverage:');
  let totalSelected = 0;
  for (const [bin, config] of Object.entries(BINS)) {
    const count = binCandidates[bin].length;
    totalSelected += count;
    const status = count >= config.target ? '[FULL]' : `[NEED ${config.target - count}]`;
    console.log(`  ${bin.padEnd(6)}: ${count}/${config.target} ${status}`);
  }

  console.log(`\nTotal selected: ${totalSelected}/30`);
  console.log(`Wallets processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`\nOutput written to: ${outputPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
