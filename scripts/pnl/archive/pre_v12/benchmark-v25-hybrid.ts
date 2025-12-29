/**
 * V25 Hybrid Engine Benchmark
 *
 * Tests the V25 hybrid approach which:
 * 1. Uses ALL source types from pm_unified_ledger_v7 (not just CLOB)
 * 2. Applies V20 formula: PnL = cash_flow + tokens * resolved_price
 * 3. Gets resolution prices from vw_pm_resolution_prices
 *
 * GOLDEN TEST:
 * - W4 + Trump 2024 market (dd22472e...) should equal ~11,447,930.97
 *
 * REGRESSION CHECK:
 * - W1, W2, W3, W5 should remain ~0% error (pure traders)
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { calculateV25PnL, calculateV25MarketPnL, calculateV25WalletPnL } from '../../lib/pnl/hybridEngineV25';
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

// Golden Test: W4 on Trump 2024 market
// NOTE: Using CORRECT condition ID (dd22472e5529...) not the old wrong one (dd22472e93a5...)
// CAVEAT: W4 may not have data for this condition in pm_unified_ledger_v7
const GOLDEN_TEST = {
  wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15',
  conditionId: 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917',
  expectedPnl: 11447930.97,  // Target from user
  label: 'W4-Trump2024',
};

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatUSD(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
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
  console.log('='.repeat(180));
  console.log('V25 HYBRID ENGINE BENCHMARK');
  console.log('='.repeat(180));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');
  console.log('V25 APPROACH: Use ALL source types from pm_unified_ledger_v7 + vw_pm_resolution_prices');
  console.log('NO Sidecar, NO source_type filtering, just V20 formula on complete data.');
  console.log('');

  // Part 1: Wallet-level comparison (V25 vs V23 vs V20)
  console.log('-'.repeat(180));
  console.log('PART 1: Wallet-Level Engine Comparison');
  console.log('-'.repeat(180));
  console.log(
    'Label | UI PnL       | V25 PnL      | V23 PnL      | V20 PnL      | V25 Err  | V23 Err  | V20 Err  | Splits | Merges | Events'
  );
  console.log('-'.repeat(180));

  const results: any[] = [];

  for (const w of UI_BENCHMARK_WALLETS) {
    try {
      const activity = await checkMergeActivity(w.wallet);

      // Run all engines
      const [v25, v23, v20] = await Promise.all([
        calculateV25PnL(w.wallet),
        calculateV23PnL(w.wallet),
        calculateV20PnL(w.wallet),
      ]);

      const v25Err = errorPct(v25.total_pnl, w.ui_pnl);
      const v23Err = errorPct(v23.realizedPnl, w.ui_pnl);
      const v20Err = errorPct(v20.total_pnl, w.ui_pnl);

      console.log(
        `${w.label.padEnd(5)} | ` +
          `${formatCompact(w.ui_pnl).padStart(12)} | ` +
          `${formatCompact(v25.total_pnl).padStart(12)} | ` +
          `${formatCompact(v23.realizedPnl).padStart(12)} | ` +
          `${formatCompact(v20.total_pnl).padStart(12)} | ` +
          `${v25Err.toFixed(1).padStart(7)}% | ` +
          `${v23Err.toFixed(1).padStart(7)}% | ` +
          `${v20Err.toFixed(1).padStart(7)}% | ` +
          `${activity.splits.toLocaleString().padStart(6)} | ` +
          `${activity.merges.toLocaleString().padStart(6)} | ` +
          `${v25.event_count.toLocaleString().padStart(6)}`
      );

      results.push({
        label: w.label,
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v25_pnl: v25.total_pnl,
        v23_pnl: v23.realizedPnl,
        v20_pnl: v20.total_pnl,
        v25_err: v25Err,
        v23_err: v23Err,
        v20_err: v20Err,
        splits: activity.splits,
        merges: activity.merges,
        events: v25.event_count,
        is_mm: activity.splits > 0 || activity.merges > 10,
        v25_details: v25,
      });
    } catch (e) {
      console.log(`${w.label.padEnd(5)} | ERROR: ${e}`);
    }
  }

  // Part 2: Summary Statistics
  console.log('');
  console.log('-'.repeat(180));
  console.log('SUMMARY STATISTICS');
  console.log('-'.repeat(180));

  const v25Errors = results.map((r) => r.v25_err);
  const v23Errors = results.map((r) => r.v23_err);
  const v20Errors = results.map((r) => r.v20_err);

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log(`V25 Hybrid     - Median Error: ${median(v25Errors).toFixed(2)}%, Mean: ${mean(v25Errors).toFixed(2)}%`);
  console.log(`V23 CLOB-only  - Median Error: ${median(v23Errors).toFixed(2)}%, Mean: ${mean(v23Errors).toFixed(2)}%`);
  console.log(`V20 Cash Flow  - Median Error: ${median(v20Errors).toFixed(2)}%, Mean: ${mean(v20Errors).toFixed(2)}%`);

  const pass10 = (errs: number[]) => errs.filter((e) => e < 10).length;
  console.log('');
  console.log(`Wallets with <10% error:`);
  console.log(`  V25: ${pass10(v25Errors)}/${results.length}`);
  console.log(`  V23: ${pass10(v23Errors)}/${results.length}`);
  console.log(`  V20: ${pass10(v20Errors)}/${results.length}`);

  // Part 3: V25 Breakdown for W4 (Market Maker)
  console.log('');
  console.log('-'.repeat(180));
  console.log('PART 2: V25 Breakdown for W4 (Market Maker)');
  console.log('-'.repeat(180));

  const w4 = results.find((r) => r.label === 'W4');
  if (w4) {
    const details = await calculateV25WalletPnL(w4.wallet);
    console.log(`Wallet: W4 (${w4.wallet.substring(0, 20)}...)`);
    console.log(`UI PnL: ${formatUSD(w4.ui_pnl)}`);
    console.log('');
    console.log('V25 Breakdown:');
    console.log(`  Realized PnL:   ${formatUSD(details.totalRealizedPnl)}`);
    console.log(`  Unrealized PnL: ${formatUSD(details.totalUnrealizedPnl)}`);
    console.log(`  Total PnL:      ${formatUSD(details.totalPnl)}`);
    console.log(`  Error:          ${w4.v25_err.toFixed(2)}%`);
    console.log('');
    console.log('Source Breakdown:');
    console.log(`  CLOB USDC:       ${formatUSD(details.clobUsdc)}`);
    console.log(`  Split USDC:      ${formatUSD(details.splitUsdc)}`);
    console.log(`  Merge USDC:      ${formatUSD(details.mergeUsdc)}`);
    console.log(`  Redemption USDC: ${formatUSD(details.redemptionUsdc)}`);
    console.log('');
    console.log(`Markets Traded: ${details.marketsTraded}`);
    console.log(`Resolved Markets: ${details.resolvedMarkets}`);
    console.log(`Unresolved Markets: ${details.unresolvedMarkets}`);
    console.log(`Events: ${details.eventCount}`);
  }

  // Part 4: GOLDEN TEST - W4 + Trump 2024
  console.log('');
  console.log('='.repeat(180));
  console.log('GOLDEN TEST: W4 + Trump 2024 Market');
  console.log('='.repeat(180));

  try {
    const goldenResult = await calculateV25MarketPnL(GOLDEN_TEST.wallet, GOLDEN_TEST.conditionId);
    const goldenError = errorPct(goldenResult.totalPnl, GOLDEN_TEST.expectedPnl);
    const passed = goldenError < 1;

    console.log(`Wallet:      ${GOLDEN_TEST.wallet}`);
    console.log(`Market:      ${GOLDEN_TEST.conditionId.substring(0, 20)}...`);
    console.log(`Expected:    ${formatUSD(GOLDEN_TEST.expectedPnl)}`);
    console.log(`Calculated:  ${formatUSD(goldenResult.totalPnl)}`);
    console.log(`Error:       ${goldenError.toFixed(4)}%`);
    console.log(`Status:      ${passed ? 'PASS' : 'FAIL'}`);
    console.log('');
    console.log('Breakdown:');
    console.log(`  Cash Flow:     ${formatUSD(goldenResult.totalCashFlow)}`);
    console.log(`  Net Tokens:    ${goldenResult.totalNetTokens.toFixed(4)}`);
    console.log(`  Realized PnL:  ${formatUSD(goldenResult.realizedPnl)}`);
    console.log(`  Unrealized:    ${formatUSD(goldenResult.unrealizedPnl)}`);
    console.log(`  Is Resolved:   ${goldenResult.isResolved}`);
    console.log('');
    console.log('Outcome Details:');
    for (const o of goldenResult.outcomes) {
      console.log(
        `  Outcome ${o.outcomeIndex}: ` +
          `cashFlow=${formatUSD(o.cashFlow)}, ` +
          `tokens=${o.netTokens.toFixed(4)}, ` +
          `price=${o.resolvedPrice?.toFixed(4) ?? 'N/A'}, ` +
          `pnl=${formatUSD(o.pnl)}`
      );
    }
    console.log('');
    console.log('Source Breakdown:');
    console.log(`  CLOB:       ${formatUSD(goldenResult.clobUsdc)}`);
    console.log(`  Split:      ${formatUSD(goldenResult.splitUsdc)}`);
    console.log(`  Merge:      ${formatUSD(goldenResult.mergeUsdc)}`);
    console.log(`  Redemption: ${formatUSD(goldenResult.redemptionUsdc)}`);
    console.log(`  Events:     ${goldenResult.eventCount}`);
  } catch (e) {
    console.log(`GOLDEN TEST ERROR: ${e}`);
  }

  // Part 5: Regression Check
  console.log('');
  console.log('-'.repeat(180));
  console.log('REGRESSION CHECK: Pure Traders (W1, W2, W3, W5)');
  console.log('-'.repeat(180));

  const pureTraders = results.filter((r) => ['W1', 'W2', 'W3', 'W5'].includes(r.label));
  let regressionsPassed = true;
  for (const r of pureTraders) {
    const passed = r.v25_err < 1;
    if (!passed) regressionsPassed = false;
    console.log(
      `${r.label}: V25 err=${r.v25_err.toFixed(2)}%, V20 err=${r.v20_err.toFixed(2)}% → ${passed ? 'PASS' : 'FAIL'}`
    );
  }
  console.log('');
  console.log(`Overall Regression: ${regressionsPassed ? 'PASSED' : 'FAILED'}`);

  console.log('');
  console.log('='.repeat(180));
  console.log('Terminal: Claude 1');
}

runBenchmark().catch(console.error);
