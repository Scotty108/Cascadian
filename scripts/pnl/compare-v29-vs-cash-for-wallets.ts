/**
 * Compare V29 vs Cash PnL for Wallets
 *
 * Compares the V29 inventory engine output against simple cash flow PnL.
 * This is useful for debugging wallets where V29 diverges significantly.
 *
 * The comparison helps identify:
 *   - Wallets where V29 inflates PnL (e.g., redemption double-counting)
 *   - Wallets where V29 underestimates (e.g., missing events)
 *   - Patterns that correlate with errors (splits, merges, redemptions)
 *
 * Usage:
 *   npx tsx scripts/pnl/compare-v29-vs-cash-for-wallets.ts
 *   npx tsx scripts/pnl/compare-v29-vs-cash-for-wallets.ts <wallet1> <wallet2> ...
 *
 * Example:
 *   npx tsx scripts/pnl/compare-v29-vs-cash-for-wallets.ts 0x7fb7ad0d... 0x82a1b239...
 */

import { calculateV29PnL, V29Result } from '../../lib/pnl/inventoryEngineV29';
import { computeWalletCashPnl, CashPnlResult, KNOWN_WALLETS } from './compute-wallet-cash-pnl';
import { clickhouse } from '../../lib/clickhouse/client';

interface ComparisonResult {
  wallet: string;
  label?: string;
  cash: CashPnlResult;
  v29: V29Result;
  // Derived comparisons
  diff_vs_cash_pnl: number;
  diff_pct: number;
  diff_vs_uiParity: number;
  diff_uiParity_pct: number;
  // Event breakdown
  split_count: number;
  merge_count: number;
  redemption_count: number;
}

async function getEventCounts(wallet: string): Promise<{ splits: number; merges: number; redemptions: number }> {
  const query = `
    SELECT
      sum(if(source_type = 'PositionSplit', 1, 0)) as splits,
      sum(if(source_type = 'PositionsMerge', 1, 0)) as merges,
      sum(if(source_type = 'PayoutRedemption', 1, 0)) as redemptions
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const row = rows[0] || { splits: 0, merges: 0, redemptions: 0 };

  return {
    splits: Number(row.splits) || 0,
    merges: Number(row.merges) || 0,
    redemptions: Number(row.redemptions) || 0,
  };
}

async function compareWallet(wallet: string, label?: string): Promise<ComparisonResult> {
  // Run cash PnL calculation
  const cash = await computeWalletCashPnl(wallet);

  // Run V29 engine
  const v29 = await calculateV29PnL(wallet, { inventoryGuard: true });

  // Get event counts
  const counts = await getEventCounts(wallet);

  // Calculate differences
  const diff_vs_cash_pnl = v29.realizedPnl - cash.total_cash_pnl;
  const diff_pct = Math.abs(cash.total_cash_pnl) > 0.01
    ? (Math.abs(diff_vs_cash_pnl) / Math.abs(cash.total_cash_pnl)) * 100
    : 0;

  const diff_vs_uiParity = v29.uiParityPnl - cash.total_cash_pnl;
  const diff_uiParity_pct = Math.abs(cash.total_cash_pnl) > 0.01
    ? (Math.abs(diff_vs_uiParity) / Math.abs(cash.total_cash_pnl)) * 100
    : 0;

  return {
    wallet: wallet.toLowerCase(),
    label,
    cash,
    v29,
    diff_vs_cash_pnl,
    diff_pct,
    diff_vs_uiParity,
    diff_uiParity_pct,
    split_count: counts.splits,
    merge_count: counts.merges,
    redemption_count: counts.redemptions,
  };
}

function printResult(r: ComparisonResult): void {
  const labelStr = r.label ? ` (${r.label})` : '';
  console.log('');
  console.log('='.repeat(100));
  console.log(`WALLET: ${r.wallet}${labelStr}`);
  console.log('='.repeat(100));

  // Cash PnL breakdown
  console.log('\n--- CASH PNL (Direct from ClickHouse) ---');
  console.log(`  CLOB trades:    Net $${r.cash.clob_net.toFixed(2)} (${r.cash.clob_count} events)`);
  console.log(`  Redemptions:    $${r.cash.redemption_cash.toFixed(2)} (${r.cash.redemption_count} events)`);
  console.log(`  TOTAL CASH:     $${r.cash.total_cash_pnl.toFixed(2)}`);

  // V29 breakdown
  console.log('\n--- V29 ENGINE OUTPUT ---');
  console.log(`  Realized PnL:         $${r.v29.realizedPnl.toFixed(2)}`);
  console.log(`  Unrealized PnL:       $${r.v29.unrealizedPnl.toFixed(2)}`);
  console.log(`  Resolved Unredeemed:  $${r.v29.resolvedUnredeemedValue.toFixed(2)}`);
  console.log(`  UI Parity PnL:        $${r.v29.uiParityPnl.toFixed(2)}`);
  console.log(`  UI Parity (clamped):  $${r.v29.uiParityClampedPnl.toFixed(2)}`);
  console.log(`  Total PnL:            $${r.v29.totalPnl.toFixed(2)}`);
  console.log(`  Positions:            ${r.v29.positionsCount} (open: ${r.v29.openPositions}, closed: ${r.v29.closedPositions})`);
  console.log(`  Events processed:     ${r.v29.eventsProcessed}`);
  console.log(`  Neg inventory pos:    ${r.v29.negativeInventoryPositions}`);

  // Event counts
  console.log('\n--- EVENT BREAKDOWN ---');
  console.log(`  Splits:      ${r.split_count}`);
  console.log(`  Merges:      ${r.merge_count}`);
  console.log(`  Redemptions: ${r.redemption_count}`);

  // Comparison
  console.log('\n--- COMPARISON ---');
  console.log(`  V29 Realized vs Cash PnL:   $${r.diff_vs_cash_pnl.toFixed(2)} (${r.diff_pct.toFixed(1)}%)`);
  console.log(`  V29 UI Parity vs Cash PnL:  $${r.diff_vs_uiParity.toFixed(2)} (${r.diff_uiParity_pct.toFixed(1)}%)`);

  // Quick diagnosis
  console.log('\n--- QUICK DIAGNOSIS ---');
  if (r.diff_pct < 5) {
    console.log('  VERDICT: GOOD - V29 matches cash PnL well');
  } else if (r.diff_pct < 20) {
    console.log('  VERDICT: MEDIUM - Some divergence, investigate further');
  } else {
    console.log('  VERDICT: BAD - Significant divergence');
  }

  if (r.v29.realizedPnl > r.cash.total_cash_pnl + 100) {
    console.log('  PATTERN: V29 inflating - possible redemption double-count or cost basis issue');
  }
  if (r.v29.realizedPnl < r.cash.total_cash_pnl - 100) {
    console.log('  PATTERN: V29 underestimating - possible missing events or wrong signs');
  }
  if (r.split_count > 50) {
    console.log('  NOTE: High split count - likely a market maker');
  }
  if (r.merge_count > 50) {
    console.log('  NOTE: High merge count - likely a market maker');
  }
  if (r.v29.negativeInventoryPositions > 0) {
    console.log(`  WARNING: ${r.v29.negativeInventoryPositions} negative inventory positions detected`);
  }
}

function printSummaryTable(results: ComparisonResult[]): void {
  console.log('');
  console.log('='.repeat(140));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(140));
  console.log('');
  console.log('Wallet           | Cash PnL         | V29 Realized     | V29 UIParity     | Diff %  | Splits | Merges | Redeem | Verdict');
  console.log('-'.repeat(140));

  for (const r of results) {
    const verdict = r.diff_pct < 5 ? 'GOOD' : r.diff_pct < 20 ? 'MEDIUM' : 'BAD';
    console.log(
      `${r.wallet.substring(0, 14)}... | $${r.cash.total_cash_pnl.toFixed(0).padStart(14)} | $${r.v29.realizedPnl.toFixed(0).padStart(14)} | $${r.v29.uiParityPnl.toFixed(0).padStart(14)} | ${r.diff_pct.toFixed(1).padStart(6)}% | ${String(r.split_count).padStart(6)} | ${String(r.merge_count).padStart(6)} | ${String(r.redemption_count).padStart(6)} | ${verdict}`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);

  console.log('='.repeat(140));
  console.log('COMPARE V29 VS CASH PNL');
  console.log('='.repeat(140));
  console.log('');
  console.log('This script compares V29 inventory engine output against simple cash flow PnL.');
  console.log('Cash PnL = CLOB net + Redemptions (direct from ClickHouse, no inventory tracking)');
  console.log('');

  let walletsToProcess: { address: string; label?: string }[] = [];

  if (args.length === 0) {
    // Use known wallets
    console.log('Using known wallets (pass wallet addresses as args to override):');
    walletsToProcess = KNOWN_WALLETS.map((w) => ({ address: w.address, label: w.label }));
  } else {
    // Use provided wallets
    walletsToProcess = args.map((addr) => {
      const known = KNOWN_WALLETS.find((w) => w.address.toLowerCase() === addr.toLowerCase());
      return { address: addr, label: known?.label };
    });
  }

  const results: ComparisonResult[] = [];

  for (let i = 0; i < walletsToProcess.length; i++) {
    const w = walletsToProcess[i];
    console.log(`\n[${i + 1}/${walletsToProcess.length}] Processing ${w.address.substring(0, 14)}...`);

    try {
      const result = await compareWallet(w.address, w.label);
      results.push(result);
      printResult(result);
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  // Print summary table
  printSummaryTable(results);

  console.log('');
  console.log('='.repeat(140));
  console.log('COMPARISON COMPLETE');
  console.log('='.repeat(140));
}

main().catch(console.error);
