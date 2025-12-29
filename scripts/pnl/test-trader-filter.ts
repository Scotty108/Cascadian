/**
 * PURE TRADER FILTER TEST
 *
 * THE THEORY:
 * We can achieve 100% accuracy by simply EXCLUDING Market Makers.
 * - Trader: 0 Splits, 0 Merges (V23 should be perfect)
 * - Market Maker: >0 Splits OR >0 Merges (EXCLUDE them)
 *
 * STEP 1: Validate on 40 benchmark wallets with known UI PnL
 * STEP 2: Check population distribution on 100 random wallets
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { calculateV23PnL } from '../../lib/pnl/shadowLedgerV23';
import { clickhouse } from '../../lib/clickhouse/client';

interface WalletClassification {
  wallet: string;
  splits: number;
  merges: number;
  isTrader: boolean;
  ui_pnl?: number;
  v23_pnl?: number;
  error_pct?: number;
  action: 'INCLUDE' | 'EXCLUDE';
}

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

// ============================================================================
// Classification Logic
// ============================================================================

async function classifyWallet(wallet: string): Promise<{ splits: number; merges: number; isTrader: boolean }> {
  const query = `
    SELECT
      countIf(source_type = 'PositionSplit') as splits,
      countIf(source_type = 'PositionsMerge') as merges
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { splits: 0, merges: 0, isTrader: true };
  }

  const splits = Number(rows[0].splits) || 0;
  const merges = Number(rows[0].merges) || 0;
  const isTrader = splits === 0 && merges === 0;

  return { splits, merges, isTrader };
}

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatUSD(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================================
// STEP 1: Benchmark Validation
// ============================================================================

async function loadBenchmarkWallets(): Promise<BenchmarkWallet[]> {
  const query = `
    SELECT wallet, pnl_value as ui_pnl
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = 'fresh_2025_12_04_alltime'
    ORDER BY abs(pnl_value) DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    wallet: r.wallet,
    ui_pnl: Number(r.ui_pnl),
  }));
}

async function runBenchmarkValidation(): Promise<WalletClassification[]> {
  console.log('='.repeat(140));
  console.log('STEP 1: BENCHMARK VALIDATION');
  console.log('Testing the "Pure Trader" filter on 40 wallets with known UI PnL');
  console.log('='.repeat(140));
  console.log('');

  const wallets = await loadBenchmarkWallets();
  console.log(`Loaded ${wallets.length} benchmark wallets`);
  console.log('');

  console.log('-'.repeat(140));
  console.log(
    '#'.padEnd(4) +
    'Wallet'.padEnd(16) +
    'UI PnL'.padStart(14) +
    'V23 PnL'.padStart(14) +
    'Error'.padStart(10) +
    'Splits'.padStart(10) +
    'Merges'.padStart(10) +
    'Type'.padStart(12) +
    'Action'.padStart(10)
  );
  console.log('-'.repeat(140));

  const results: WalletClassification[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      // Classify wallet
      const { splits, merges, isTrader } = await classifyWallet(w.wallet);

      // Calculate V23 PnL (only for traders, but we do it for all to verify)
      const v23 = await calculateV23PnL(w.wallet);
      const err = errorPct(v23.realizedPnl, w.ui_pnl);

      const classification: WalletClassification = {
        wallet: w.wallet,
        splits,
        merges,
        isTrader,
        ui_pnl: w.ui_pnl,
        v23_pnl: v23.realizedPnl,
        error_pct: err,
        action: isTrader ? 'INCLUDE' : 'EXCLUDE',
      };
      results.push(classification);

      // Print row
      const walletShort = w.wallet.substring(0, 14);
      const typeLabel = isTrader ? 'TRADER' : 'MM';
      const errStr = err < 1 ? `${err.toFixed(2)}%` : `${err.toFixed(1)}%`;

      console.log(
        (i + 1).toString().padEnd(4) +
        walletShort.padEnd(16) +
        formatUSD(w.ui_pnl).padStart(14) +
        formatUSD(v23.realizedPnl).padStart(14) +
        errStr.padStart(10) +
        splits.toLocaleString().padStart(10) +
        merges.toLocaleString().padStart(10) +
        typeLabel.padStart(12) +
        classification.action.padStart(10)
      );

      // Small delay to avoid ClickHouse overload
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (e) {
      console.log(`${(i + 1).toString().padEnd(4)}${w.wallet.substring(0, 14).padEnd(16)} ERROR: ${e}`);
    }
  }

  return results;
}

// ============================================================================
// STEP 2: Population Analysis
// ============================================================================

async function runPopulationAnalysis(): Promise<void> {
  console.log('');
  console.log('='.repeat(140));
  console.log('STEP 2: POPULATION ANALYSIS');
  console.log('Checking 100 random wallets to estimate "Safe Pool" size');
  console.log('='.repeat(140));
  console.log('');

  // Get 100 recent unique wallets from pm_trader_events_v2
  const query = `
    SELECT DISTINCT trader_wallet as wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    ORDER BY trade_time DESC
    LIMIT 100
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = (await result.json()) as any[];

  console.log(`Fetched ${wallets.length} random wallets`);
  console.log('');

  let traders = 0;
  let marketMakers = 0;

  console.log('-'.repeat(80));
  console.log('#'.padEnd(4) + 'Wallet'.padEnd(44) + 'Splits'.padStart(10) + 'Merges'.padStart(10) + 'Type'.padStart(12));
  console.log('-'.repeat(80));

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i].wallet;
    try {
      const { splits, merges, isTrader } = await classifyWallet(wallet);

      if (isTrader) {
        traders++;
      } else {
        marketMakers++;
      }

      const typeLabel = isTrader ? 'TRADER' : 'MM';
      console.log(
        (i + 1).toString().padEnd(4) +
        wallet.substring(0, 42).padEnd(44) +
        splits.toLocaleString().padStart(10) +
        merges.toLocaleString().padStart(10) +
        typeLabel.padStart(12)
      );

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (e) {
      console.log(`${(i + 1).toString().padEnd(4)}${wallet.substring(0, 42).padEnd(44)} ERROR`);
    }
  }

  console.log('');
  console.log('-'.repeat(80));
  console.log('POPULATION SUMMARY:');
  console.log(`  Total Wallets Analyzed: ${wallets.length}`);
  console.log(`  Pure Traders (Safe to Copy): ${traders} (${((traders / wallets.length) * 100).toFixed(1)}%)`);
  console.log(`  Market Makers (Excluded): ${marketMakers} (${((marketMakers / wallets.length) * 100).toFixed(1)}%)`);
  console.log('-'.repeat(80));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                    PURE TRADER FILTER TEST                                                                             ║');
  console.log('║  Theory: Filter out Market Makers (splits/merges > 0) to achieve 100% V23 accuracy                                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // STEP 1: Benchmark Validation
  const benchmarkResults = await runBenchmarkValidation();

  // Analyze benchmark results
  const traders = benchmarkResults.filter(r => r.isTrader);
  const marketMakers = benchmarkResults.filter(r => !r.isTrader);

  const traderErrors = traders.map(r => r.error_pct || 0);
  const mmErrors = marketMakers.map(r => r.error_pct || 0);

  const traderPassing = traders.filter(r => (r.error_pct || 0) < 1).length;
  const mmPassing = marketMakers.filter(r => (r.error_pct || 0) < 5).length;

  console.log('');
  console.log('='.repeat(140));
  console.log('BENCHMARK VALIDATION RESULTS');
  console.log('='.repeat(140));
  console.log('');
  console.log('Classification Breakdown:');
  console.log(`  TRADERS (Splits=0, Merges=0): ${traders.length} wallets`);
  console.log(`  MARKET MAKERS (Splits>0 OR Merges>0): ${marketMakers.length} wallets`);
  console.log('');
  console.log('V23 Accuracy for TRADERS (threshold <1%):');
  if (traders.length > 0) {
    const avgErr = traderErrors.reduce((a, b) => a + b, 0) / traders.length;
    const medianErr = traderErrors.sort((a, b) => a - b)[Math.floor(traders.length / 2)];
    console.log(`  Pass Rate: ${traderPassing}/${traders.length} (${((traderPassing / traders.length) * 100).toFixed(1)}%)`);
    console.log(`  Mean Error: ${avgErr.toFixed(2)}%`);
    console.log(`  Median Error: ${medianErr.toFixed(2)}%`);
  } else {
    console.log('  No traders in benchmark set');
  }
  console.log('');
  console.log('V23 Accuracy for MARKET MAKERS (threshold <5%):');
  if (marketMakers.length > 0) {
    const avgErr = mmErrors.reduce((a, b) => a + b, 0) / marketMakers.length;
    const medianErr = mmErrors.sort((a, b) => a - b)[Math.floor(marketMakers.length / 2)];
    console.log(`  Pass Rate: ${mmPassing}/${marketMakers.length} (${((mmPassing / marketMakers.length) * 100).toFixed(1)}%)`);
    console.log(`  Mean Error: ${avgErr.toFixed(2)}%`);
    console.log(`  Median Error: ${medianErr.toFixed(2)}%`);
  } else {
    console.log('  No market makers in benchmark set');
  }
  console.log('');

  // Key insight: Show the worst traders
  console.log('Worst TRADER Errors (should be near 0%):');
  const worstTraders = [...traders].sort((a, b) => (b.error_pct || 0) - (a.error_pct || 0)).slice(0, 5);
  for (const t of worstTraders) {
    console.log(`  ${t.wallet.substring(0, 14)}... UI: ${formatUSD(t.ui_pnl!)}, V23: ${formatUSD(t.v23_pnl!)}, Err: ${t.error_pct?.toFixed(2)}%`);
  }
  console.log('');

  // STEP 2: Population Analysis
  await runPopulationAnalysis();

  // Final Summary
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                           FINAL VERDICT                                                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const traderPassRate = traders.length > 0 ? (traderPassing / traders.length) * 100 : 0;
  const filterSuccess = traderPassRate >= 90;

  if (filterSuccess) {
    console.log('✓ FILTER VALIDATED: Pure Trader filter achieves target accuracy');
    console.log(`  - Traders: ${traderPassRate.toFixed(1)}% pass rate (target: 90%)`);
    console.log(`  - Market Makers correctly excluded`);
  } else {
    console.log('✗ FILTER NEEDS WORK: Pure Trader filter does not achieve target');
    console.log(`  - Traders: ${traderPassRate.toFixed(1)}% pass rate (target: 90%)`);
    console.log('  - Need to investigate why some traders have high errors');
  }

  console.log('');
  console.log('Terminal: Claude 1');
}

main().catch(console.error);
