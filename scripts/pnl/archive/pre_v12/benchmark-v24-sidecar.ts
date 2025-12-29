/**
 * V24 CTF Sidecar PnL Engine Benchmark
 *
 * Tests the CTF Sidecar approach which:
 * 1. Uses V23 CLOB-only as base (0% error for pure traders)
 * 2. Adds normalized Split/Merge handling from pm_ctf_events
 * 3. Compares: V24 (base), V24 (with adjustment), V23, V20
 *
 * Focus: W4 (Market Maker) which has 85.8% error in V23
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { calculateV24PnL, calculateV24WithAdjustment, SidecarResult } from '../../lib/pnl/ctfSidecarEngine';
import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { clickhouse } from '../../lib/clickhouse/client';

// Benchmark wallets (W1-W6)
const UI_BENCHMARK_WALLETS = [
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', label: 'W1', ui_pnl: -6138.9 },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2', ui_pnl: 4404.92 },
  { wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786', label: 'W3', ui_pnl: 5.44 },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', label: 'W4', ui_pnl: -294.61 },  // Market Maker
  { wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', label: 'W5', ui_pnl: 146.9 },
  { wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', label: 'W6', ui_pnl: 470.4 },
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
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND is_deleted = 0
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
  console.log('='.repeat(180));
  console.log('V24 CTF SIDECAR PNL ENGINE BENCHMARK');
  console.log('='.repeat(180));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');
  console.log('HYPOTHESIS: V24 should fix Market Maker wallets by properly handling Split/Merge with unit normalization.');
  console.log('');

  // Part 1: Compare all engines
  console.log('-'.repeat(180));
  console.log('PART 1: Engine Comparison (V24 vs V24-Adjusted vs V23 vs V20)');
  console.log('-'.repeat(180));
  console.log(
    'Label | UI PnL       | V24 Base     | V24+Adj      | V23 PnL      | V20 PnL      | V24 Err  | V24+Adj  | V23 Err  | V20 Err  | Splits | Merges'
  );
  console.log('-'.repeat(180));

  const results: any[] = [];

  for (const w of UI_BENCHMARK_WALLETS) {
    try {
      const activity = await checkMergeActivity(w.wallet);

      // Run all engines
      const [v24, v24adj, v23, v20] = await Promise.all([
        calculateV24PnL(w.wallet),
        calculateV24WithAdjustment(w.wallet),
        calculateV23PnL(w.wallet),
        calculateV20PnL(w.wallet),
      ]);

      const v24Err = errorPct(v24.totalPnl, w.ui_pnl);
      const v24AdjErr = errorPct(v24adj.totalPnl, w.ui_pnl);
      const v23Err = errorPct(v23.realizedPnl, w.ui_pnl);
      const v20Err = errorPct(v20.total_pnl, w.ui_pnl);

      console.log(
        `${w.label.padEnd(5)} | ` +
          `${formatCompact(w.ui_pnl).padStart(12)} | ` +
          `${formatCompact(v24.totalPnl).padStart(12)} | ` +
          `${formatCompact(v24adj.totalPnl).padStart(12)} | ` +
          `${formatCompact(v23.realizedPnl).padStart(12)} | ` +
          `${formatCompact(v20.total_pnl).padStart(12)} | ` +
          `${v24Err.toFixed(1).padStart(7)}% | ` +
          `${v24AdjErr.toFixed(1).padStart(7)}% | ` +
          `${v23Err.toFixed(1).padStart(7)}% | ` +
          `${v20Err.toFixed(1).padStart(7)}% | ` +
          `${activity.splits.toLocaleString().padStart(6)} | ` +
          `${activity.merges.toLocaleString().padStart(6)}`
      );

      results.push({
        label: w.label,
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v24_pnl: v24.totalPnl,
        v24adj_pnl: v24adj.totalPnl,
        v23_pnl: v23.realizedPnl,
        v20_pnl: v20.total_pnl,
        v24_err: v24Err,
        v24adj_err: v24AdjErr,
        v23_err: v23Err,
        v20_err: v20Err,
        splits: activity.splits,
        merges: activity.merges,
        is_mm: activity.splits > 0 || activity.merges > 10,
        v24_details: v24,
      });
    } catch (e) {
      console.log(`${w.label.padEnd(5)} | ERROR: ${e}`);
    }
  }

  // Part 2: V24 Sidecar Breakdown
  console.log('');
  console.log('-'.repeat(180));
  console.log('PART 2: V24 CTF Sidecar Breakdown');
  console.log('-'.repeat(180));
  console.log('Label | CLOB PnL     | Split Cost   | Merge Proceeds | S/M Net PnL  | CTF Events');
  console.log('-'.repeat(180));

  for (const r of results) {
    const v24 = r.v24_details as SidecarResult;
    console.log(
      `${r.label.padEnd(5)} | ` +
        `${formatCompact(v24.clobRealizedPnl).padStart(12)} | ` +
        `${formatCompact(v24.splitCostBasis).padStart(12)} | ` +
        `${formatCompact(v24.mergeProceeds).padStart(14)} | ` +
        `${formatCompact(v24.splitMergeNetPnl).padStart(12)} | ` +
        `${v24.eventsProcessed.toString().padStart(10)}`
    );
  }

  // Part 3: Summary Statistics
  console.log('');
  console.log('-'.repeat(180));
  console.log('SUMMARY STATISTICS');
  console.log('-'.repeat(180));

  const v24Errors = results.map((r) => r.v24_err);
  const v24AdjErrors = results.map((r) => r.v24adj_err);
  const v23Errors = results.map((r) => r.v23_err);
  const v20Errors = results.map((r) => r.v20_err);

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log(`V24 Base        - Median Error: ${median(v24Errors).toFixed(2)}%, Mean: ${mean(v24Errors).toFixed(2)}%`);
  console.log(`V24 + Adjustment- Median Error: ${median(v24AdjErrors).toFixed(2)}%, Mean: ${mean(v24AdjErrors).toFixed(2)}%`);
  console.log(`V23 CLOB-only   - Median Error: ${median(v23Errors).toFixed(2)}%, Mean: ${mean(v23Errors).toFixed(2)}%`);
  console.log(`V20 Cash Flow   - Median Error: ${median(v20Errors).toFixed(2)}%, Mean: ${mean(v20Errors).toFixed(2)}%`);

  const pass10 = (errs: number[]) => errs.filter((e) => e < 10).length;
  console.log('');
  console.log(`Wallets with <10% error:`);
  console.log(`  V24 Base:       ${pass10(v24Errors)}/${results.length}`);
  console.log(`  V24+Adj:        ${pass10(v24AdjErrors)}/${results.length}`);
  console.log(`  V23:            ${pass10(v23Errors)}/${results.length}`);
  console.log(`  V20:            ${pass10(v20Errors)}/${results.length}`);

  // Part 4: Focus on Market Maker (W4)
  console.log('');
  console.log('-'.repeat(180));
  console.log('PART 3: W4 (Market Maker) Deep Dive');
  console.log('-'.repeat(180));

  const w4 = results.find((r) => r.label === 'W4');
  if (w4) {
    const v24 = w4.v24_details as SidecarResult;
    console.log(`Wallet: W4 (${w4.wallet.substring(0, 20)}...)`);
    console.log(`UI PnL: ${formatUSD(w4.ui_pnl)}`);
    console.log('');
    console.log('Engine Results:');
    console.log(`  V24 Base:        ${formatUSD(w4.v24_pnl)} (${w4.v24_err.toFixed(2)}% error)`);
    console.log(`  V24 + Adjustment:${formatUSD(w4.v24adj_pnl)} (${w4.v24adj_err.toFixed(2)}% error)`);
    console.log(`  V23 (CLOB-only): ${formatUSD(w4.v23_pnl)} (${w4.v23_err.toFixed(2)}% error)`);
    console.log(`  V20:             ${formatUSD(w4.v20_pnl)} (${w4.v20_err.toFixed(2)}% error)`);
    console.log('');
    console.log('V24 Sidecar Breakdown:');
    console.log(`  CLOB PnL:        ${formatUSD(v24.clobRealizedPnl)}`);
    console.log(`  Split Cost:      ${formatUSD(v24.splitCostBasis)}`);
    console.log(`  Merge Proceeds:  ${formatUSD(v24.mergeProceeds)}`);
    console.log(`  S/M Net PnL:     ${formatUSD(v24.splitMergeNetPnl)}`);
    console.log(`  CTF Events:      ${v24.eventsProcessed}`);
    console.log(`  Splits/Merges:   ${w4.splits}/${w4.merges}`);
  }

  console.log('');
  console.log('='.repeat(180));
  console.log('Terminal: Claude 1');
}

runBenchmark().catch(console.error);
