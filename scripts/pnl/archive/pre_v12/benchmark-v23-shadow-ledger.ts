/**
 * V23 Shadow Ledger PnL Engine Benchmark
 *
 * Tests the new state-machine approach against:
 * 1. Original UI benchmark wallets (W1-W6)
 * 2. Real wallets from Polymarket Leaderboard
 * 3. Compares V23 vs V20/V22 to verify improvements
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { calculateV23PnL, ShadowLedgerResult } from '../../lib/pnl/shadowLedgerV23';
import { calculateV22PnL } from '../../lib/pnl/uiActivityEngineV22';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { clickhouse } from '../../lib/clickhouse/client';

// Original W1-W6 benchmark wallets
const UI_BENCHMARK_WALLETS = [
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', label: 'W1', ui_pnl: -6138.9 },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2', ui_pnl: 4404.92 },
  { wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786', label: 'W3', ui_pnl: 5.44 },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', label: 'W4', ui_pnl: -294.61 },
  { wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', label: 'W5', ui_pnl: 146.9 },
  { wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', label: 'W6', ui_pnl: 470.4 },
];

// Real wallets from Polymarket Leaderboard (2025-12-03)
const LEADERBOARD_WALLETS = [
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4', ui_pnl: 22053934 },
  { wallet: '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', name: 'Fredi9999', ui_pnl: 16620028 },
  { wallet: '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', name: 'Len9311238', ui_pnl: 8709973 },
  { wallet: '0xd235973291b2b75ff4070e9c0b01728c520b0f29', name: 'zxgngl', ui_pnl: 7807266 },
  { wallet: '0x863134d00841b2e200492805a01e1e2f5defaa53', name: 'RepTrump', ui_pnl: 7532410 },
];

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatUSD(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

async function checkMergeActivity(wallet: string): Promise<{ splits: number; merges: number }> {
  const query = `
    SELECT
      countIf(source_type = 'PositionSplit') as splits,
      countIf(source_type = 'PositionsMerge') as merges
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  if (rows.length === 0) return { splits: 0, merges: 0 };
  return {
    splits: Number(rows[0].splits) || 0,
    merges: Number(rows[0].merges) || 0,
  };
}

async function runBenchmark() {
  console.log('='.repeat(150));
  console.log('V23 SHADOW LEDGER PNL ENGINE BENCHMARK');
  console.log('='.repeat(150));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');
  console.log('HYPOTHESIS: V23 should fix Market Maker wallets by properly tracking Split cost basis.');
  console.log('');

  // Part 1: Original benchmark wallets (W1-W6)
  console.log('-'.repeat(150));
  console.log('PART 1: Original UI Benchmark Wallets (W1-W6)');
  console.log('-'.repeat(150));
  console.log(
    'Label | UI PnL       | V23 PnL      | V22 PnL      | V20 PnL      | V23 Err  | V22 Err  | V20 Err  | Splits | Merges | V23 S/M PnL'
  );
  console.log('-'.repeat(150));

  const results: any[] = [];

  for (const w of UI_BENCHMARK_WALLETS) {
    try {
      // Get merge activity to identify MMs
      const activity = await checkMergeActivity(w.wallet);

      // Run all three engines
      const [v23, v22, v20] = await Promise.all([
        calculateV23PnL(w.wallet),
        calculateV22PnL(w.wallet),
        calculateV20PnL(w.wallet),
      ]);

      const v23Err = errorPct(v23.realizedPnl, w.ui_pnl);
      const v22Err = errorPct(v22.total_pnl, w.ui_pnl);
      const v20Err = errorPct(v20.total_pnl, w.ui_pnl);

      // Determine best engine for this wallet
      const bestErr = Math.min(v23Err, v22Err, v20Err);
      const bestEngine = bestErr === v23Err ? 'V23' : bestErr === v22Err ? 'V22' : 'V20';

      console.log(
        `${w.label.padEnd(5)} | ` +
          `${formatCompact(w.ui_pnl).padStart(12)} | ` +
          `${formatCompact(v23.realizedPnl).padStart(12)} | ` +
          `${formatCompact(v22.total_pnl).padStart(12)} | ` +
          `${formatCompact(v20.total_pnl).padStart(12)} | ` +
          `${v23Err.toFixed(1).padStart(7)}% | ` +
          `${v22Err.toFixed(1).padStart(7)}% | ` +
          `${v20Err.toFixed(1).padStart(7)}% | ` +
          `${activity.splits.toLocaleString().padStart(6)} | ` +
          `${activity.merges.toLocaleString().padStart(6)} | ` +
          `${formatCompact(v23.splitMergePnl).padStart(11)}`
      );

      results.push({
        label: w.label,
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v23_pnl: v23.realizedPnl,
        v22_pnl: v22.total_pnl,
        v20_pnl: v20.total_pnl,
        v23_err: v23Err,
        v22_err: v22Err,
        v20_err: v20Err,
        splits: activity.splits,
        merges: activity.merges,
        is_mm: activity.splits > 10 || activity.merges > 10,
        best_engine: bestEngine,
        v23_details: v23,
      });
    } catch (e) {
      console.log(`${w.label.padEnd(5)} | ERROR: ${e}`);
    }
  }

  console.log('');

  // Part 2: Analysis - MM vs Non-MM
  console.log('-'.repeat(150));
  console.log('PART 2: Market Maker vs Retail Analysis');
  console.log('-'.repeat(150));

  const mmWallets = results.filter((r) => r.is_mm);
  const retailWallets = results.filter((r) => !r.is_mm);

  console.log(`Market Maker wallets (>10 splits or merges): ${mmWallets.length}`);
  for (const r of mmWallets) {
    const improvement = r.v20_err - r.v23_err;
    console.log(
      `  ${r.label}: V23 err=${r.v23_err.toFixed(1)}%, V20 err=${r.v20_err.toFixed(1)}% → ` +
        `${improvement > 0 ? 'IMPROVED' : improvement < 0 ? 'WORSE' : 'SAME'} by ${Math.abs(improvement).toFixed(1)}%`
    );
  }

  console.log('');
  console.log(`Retail wallets (<10 splits/merges): ${retailWallets.length}`);
  for (const r of retailWallets) {
    const improvement = r.v20_err - r.v23_err;
    console.log(
      `  ${r.label}: V23 err=${r.v23_err.toFixed(1)}%, V20 err=${r.v20_err.toFixed(1)}% → ` +
        `${improvement > 0 ? 'IMPROVED' : improvement < 0 ? 'WORSE' : 'SAME'} by ${Math.abs(improvement).toFixed(1)}%`
    );
  }

  // Part 3: V23 Diagnostic Breakdown for MMs
  console.log('');
  console.log('-'.repeat(150));
  console.log('PART 3: V23 PnL Component Breakdown');
  console.log('-'.repeat(150));
  console.log('Label | CLOB PnL     | Split/Merge PnL | Redemption PnL | Total Realized | Open Pos | Errors');
  console.log('-'.repeat(150));

  for (const r of results) {
    const v23 = r.v23_details as ShadowLedgerResult;
    console.log(
      `${r.label.padEnd(5)} | ` +
        `${formatCompact(v23.clobPnl).padStart(12)} | ` +
        `${formatCompact(v23.splitMergePnl).padStart(15)} | ` +
        `${formatCompact(v23.redemptionPnl).padStart(14)} | ` +
        `${formatCompact(v23.realizedPnl).padStart(14)} | ` +
        `${v23.openPositions.toString().padStart(8)} | ` +
        `${v23.errors.length}`
    );
  }

  // Part 4: Summary Statistics
  console.log('');
  console.log('-'.repeat(150));
  console.log('SUMMARY STATISTICS');
  console.log('-'.repeat(150));

  const v23Errors = results.map((r) => r.v23_err);
  const v22Errors = results.map((r) => r.v22_err);
  const v20Errors = results.map((r) => r.v20_err);

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log(`V23 Shadow Ledger - Median Error: ${median(v23Errors).toFixed(2)}%, Mean: ${mean(v23Errors).toFixed(2)}%`);
  console.log(`V22 Dual Formula  - Median Error: ${median(v22Errors).toFixed(2)}%, Mean: ${mean(v22Errors).toFixed(2)}%`);
  console.log(`V20 Cash Flow     - Median Error: ${median(v20Errors).toFixed(2)}%, Mean: ${mean(v20Errors).toFixed(2)}%`);

  const v23Passes = v23Errors.filter((e) => e < 10).length;
  const v22Passes = v22Errors.filter((e) => e < 10).length;
  const v20Passes = v20Errors.filter((e) => e < 10).length;

  console.log('');
  console.log(`Wallets with <10% error:`);
  console.log(`  V23: ${v23Passes}/${results.length} (${((v23Passes / results.length) * 100).toFixed(0)}%)`);
  console.log(`  V22: ${v22Passes}/${results.length} (${((v22Passes / results.length) * 100).toFixed(0)}%)`);
  console.log(`  V20: ${v20Passes}/${results.length} (${((v20Passes / results.length) * 100).toFixed(0)}%)`);

  // Part 5: Check a leaderboard wallet for good measure
  console.log('');
  console.log('-'.repeat(150));
  console.log('PART 4: Leaderboard Wallet Spot Check (Theo4)');
  console.log('-'.repeat(150));

  const theo = LEADERBOARD_WALLETS[0];
  try {
    const [v23, activity] = await Promise.all([calculateV23PnL(theo.wallet), checkMergeActivity(theo.wallet)]);

    console.log(`Wallet: ${theo.name} (${theo.wallet.substring(0, 20)}...)`);
    console.log(`UI PnL: ${formatUSD(theo.ui_pnl)}`);
    console.log(`V23 Realized PnL: ${formatUSD(v23.realizedPnl)}`);
    console.log(`V23 Error: ${errorPct(v23.realizedPnl, theo.ui_pnl).toFixed(2)}%`);
    console.log(`Events Processed: ${v23.eventsProcessed.toLocaleString()}`);
    console.log(`Open Positions: ${v23.openPositions}`);
    console.log(`Closed Positions: ${v23.closedPositions}`);
    console.log(`Splits: ${activity.splits.toLocaleString()}, Merges: ${activity.merges.toLocaleString()}`);
    console.log('');
    console.log('Breakdown:');
    console.log(`  CLOB PnL:        ${formatUSD(v23.clobPnl)}`);
    console.log(`  Split/Merge PnL: ${formatUSD(v23.splitMergePnl)}`);
    console.log(`  Redemption PnL:  ${formatUSD(v23.redemptionPnl)}`);

    if (v23.errors.length > 0) {
      console.log('');
      console.log(`Errors (first 5): ${v23.errors.slice(0, 5).join(', ')}`);
    }
  } catch (e) {
    console.log(`ERROR: ${e}`);
  }

  console.log('');
  console.log('='.repeat(150));
  console.log('Terminal: Claude 1');
}

runBenchmark().catch(console.error);
