/**
 * ============================================================================
 * AUDIT: 80% REJECTION RATE INVESTIGATION
 * ============================================================================
 *
 * PURPOSE: Understand why 80% of benchmark wallets (32/40) are being excluded.
 *
 * THEORIES:
 * A) Dataset Bias: All-Time Leaderboard is full of Makers/Whales
 * B) Filter Bug: Inventory Mismatch threshold is too strict (dust/rounding)
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  isTraderStrict,
  TRADER_STRICT_THRESHOLDS,
} from '../../lib/pnl/walletClassifier';

// ============================================================================
// Configuration
// ============================================================================

const BENCHMARK_SET = 'fresh_2025_12_04_alltime';

interface RejectAuditResult {
  wallet: string;
  ui_pnl: number;
  status: 'TRADER_STRICT' | 'REJECTED';
  reject_reason: string;
  split_count: number;
  merge_count: number;
  inventory_gap: number;
  transfer_in_value: number;
  clob_events: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatPnL(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        AUDIT: 80% REJECTION RATE INVESTIGATION                                        ║');
  console.log('║  Why are 32/40 wallets being excluded from TRADER_STRICT?                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${BENCHMARK_SET}`);
  console.log('');

  // Show current thresholds
  console.log('═'.repeat(100));
  console.log('CURRENT THRESHOLDS');
  console.log('═'.repeat(100));
  console.log(`  INVENTORY_MISMATCH_MAX: ${TRADER_STRICT_THRESHOLDS.INVENTORY_MISMATCH_MAX} tokens`);
  console.log(`  TRANSFER_IN_VALUE_MAX: $${TRADER_STRICT_THRESHOLDS.TRANSFER_IN_VALUE_MAX}`);
  console.log(`  SPLIT_EVENTS_MAX: ${TRADER_STRICT_THRESHOLDS.SPLIT_EVENTS_MAX}`);
  console.log(`  MERGE_EVENTS_MAX: ${TRADER_STRICT_THRESHOLDS.MERGE_EVENTS_MAX}`);
  console.log('');

  // Load benchmark wallets
  const query = `
    SELECT wallet, pnl_value as ui_pnl, note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${BENCHMARK_SET}'
    ORDER BY pnl_value DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log(`Loaded ${rows.length} wallets from benchmark`);
  console.log('');

  // Analyze each wallet
  const results: RejectAuditResult[] = [];
  const rejectReasons: Record<string, number> = {};

  for (let i = 0; i < rows.length; i++) {
    const w = rows[i];
    process.stdout.write(`\rAnalyzing wallet ${i + 1}/${rows.length}: ${w.wallet.substring(0, 16)}...`);

    try {
      const strictCheck = await isTraderStrict(w.wallet);

      let status: 'TRADER_STRICT' | 'REJECTED' = strictCheck.is_trader_strict ? 'TRADER_STRICT' : 'REJECTED';
      let reject_reason = strictCheck.is_trader_strict ? 'N/A' : strictCheck.reasons[0] || 'Unknown';

      // Categorize the reason
      if (!strictCheck.is_trader_strict) {
        if (strictCheck.activity.split_events > 0) {
          const key = strictCheck.activity.split_events > 100 ? 'HEAVY MAKER (>100 splits)' : `SPLITS (${strictCheck.activity.split_events})`;
          rejectReasons[key] = (rejectReasons[key] || 0) + 1;
        } else if (strictCheck.activity.merge_events > 0) {
          const key = strictCheck.activity.merge_events > 100 ? 'HEAVY MAKER (>100 merges)' : `MERGES (${strictCheck.activity.merge_events})`;
          rejectReasons[key] = (rejectReasons[key] || 0) + 1;
        } else if (!strictCheck.inventory.is_consistent) {
          const gap = strictCheck.inventory.inventory_mismatch;
          let key: string;
          if (gap <= 10) key = 'INVENTORY GAP (5-10 tokens) - BORDERLINE';
          else if (gap <= 100) key = 'INVENTORY GAP (10-100 tokens)';
          else if (gap <= 1000) key = 'INVENTORY GAP (100-1K tokens)';
          else key = 'INVENTORY GAP (>1K tokens) - MAJOR';
          rejectReasons[key] = (rejectReasons[key] || 0) + 1;
        } else if (strictCheck.transfers.is_transfer_heavy) {
          rejectReasons['TRANSFER HEAVY'] = (rejectReasons['TRANSFER HEAVY'] || 0) + 1;
        } else {
          rejectReasons['OTHER'] = (rejectReasons['OTHER'] || 0) + 1;
        }
      }

      results.push({
        wallet: w.wallet,
        ui_pnl: Number(w.ui_pnl),
        status,
        reject_reason,
        split_count: strictCheck.activity.split_events,
        merge_count: strictCheck.activity.merge_events,
        inventory_gap: strictCheck.inventory.inventory_mismatch,
        transfer_in_value: strictCheck.transfers.transfer_in_value,
        clob_events: strictCheck.activity.clob_events,
      });
    } catch (err: any) {
      results.push({
        wallet: w.wallet,
        ui_pnl: Number(w.ui_pnl),
        status: 'REJECTED',
        reject_reason: `Error: ${err.message}`,
        split_count: 0,
        merge_count: 0,
        inventory_gap: 0,
        transfer_in_value: 0,
        clob_events: 0,
      });
      rejectReasons['ERROR'] = (rejectReasons['ERROR'] || 0) + 1;
    }
  }

  console.log('\n');

  // Summary by rejection reason
  console.log('═'.repeat(100));
  console.log('REJECTION REASON BREAKDOWN');
  console.log('═'.repeat(100));
  console.log('');

  const sortedReasons = Object.entries(rejectReasons).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons) {
    const pct = ((count / rows.length) * 100).toFixed(1);
    console.log(`  ${reason.padEnd(40)} ${count.toString().padStart(3)} wallets (${pct}%)`);
  }
  console.log('');

  // Detailed table
  console.log('═'.repeat(100));
  console.log('DETAILED WALLET BREAKDOWN');
  console.log('═'.repeat(100));
  console.log('');

  console.log('| Wallet | UI PnL | Status | Reason | Splits | Merges | Inv Gap | Transfers |');
  console.log('|--------|--------|--------|--------|--------|--------|---------|-----------|');

  // Sort: TRADER_STRICT first, then by inventory gap
  const sortedResults = results.sort((a, b) => {
    if (a.status === 'TRADER_STRICT' && b.status !== 'TRADER_STRICT') return -1;
    if (a.status !== 'TRADER_STRICT' && b.status === 'TRADER_STRICT') return 1;
    return a.inventory_gap - b.inventory_gap;
  });

  for (const r of sortedResults) {
    const statusIcon = r.status === 'TRADER_STRICT' ? '✓' : '✗';
    const reasonShort = r.reject_reason.length > 30 ? r.reject_reason.substring(0, 27) + '...' : r.reject_reason;
    console.log(
      `| ${r.wallet.substring(0, 12)}... | ${formatPnL(r.ui_pnl).padStart(10)} | ${statusIcon} ${r.status.padEnd(12)} | ${reasonShort.padEnd(30)} | ${r.split_count.toString().padStart(6)} | ${r.merge_count.toString().padStart(6)} | ${r.inventory_gap.toFixed(1).padStart(7)} | $${r.transfer_in_value.toFixed(0).padStart(8)} |`
    );
  }

  console.log('');

  // Check for borderline cases
  console.log('═'.repeat(100));
  console.log('BORDERLINE CASES (Inventory Gap 5-10 tokens)');
  console.log('═'.repeat(100));
  console.log('');

  const borderline = results.filter(
    (r) =>
      r.status === 'REJECTED' &&
      r.split_count === 0 &&
      r.merge_count === 0 &&
      r.inventory_gap > 5 &&
      r.inventory_gap <= 10
  );

  if (borderline.length > 0) {
    console.log(`⚠️  ${borderline.length} wallets have inventory gap between 5-10 tokens`);
    console.log('   These might be affected by dust/rounding. Consider raising threshold to 10.');
    console.log('');
    for (const b of borderline) {
      console.log(`   - ${b.wallet.substring(0, 20)}... | Gap: ${b.inventory_gap.toFixed(2)} tokens`);
    }
  } else {
    console.log('   No borderline cases found (gap 5-10 tokens).');
  }

  console.log('');

  // Summary statistics
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log('');

  const traderStrict = results.filter((r) => r.status === 'TRADER_STRICT').length;
  const rejected = results.filter((r) => r.status === 'REJECTED').length;
  const heavyMakers = results.filter((r) => r.split_count > 100 || r.merge_count > 100).length;
  const anyMakerActivity = results.filter((r) => r.split_count > 0 || r.merge_count > 0).length;
  const inventoryOnly = results.filter(
    (r) => r.status === 'REJECTED' && r.split_count === 0 && r.merge_count === 0 && r.inventory_gap > 5
  ).length;

  console.log(`  Total Wallets:          ${rows.length}`);
  console.log(`  TRADER_STRICT:          ${traderStrict} (${((traderStrict / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  REJECTED:               ${rejected} (${((rejected / rows.length) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('  Breakdown of REJECTED:');
  console.log(`    Heavy Makers (>100):  ${heavyMakers}`);
  console.log(`    Any Maker Activity:   ${anyMakerActivity}`);
  console.log(`    Inventory Gap Only:   ${inventoryOnly}`);
  console.log('');

  // Verdict
  console.log('═'.repeat(100));
  console.log('VERDICT');
  console.log('═'.repeat(100));
  console.log('');

  if (anyMakerActivity >= rejected * 0.7) {
    console.log('🎯 THEORY A CONFIRMED: Dataset is biased toward Market Makers');
    console.log('');
    console.log(`   ${anyMakerActivity}/${rejected} rejected wallets (${((anyMakerActivity / rejected) * 100).toFixed(0)}%) have Split/Merge activity.`);
    console.log('   This is expected for All-Time Leaderboard - these are whales/makers.');
    console.log('   The 80% rejection rate is WORKING AS INTENDED.');
  } else if (borderline.length >= 5) {
    console.log('🔧 THEORY B CONFIRMED: Inventory threshold is too strict');
    console.log('');
    console.log(`   ${borderline.length} wallets are borderline (gap 5-10 tokens).`);
    console.log('   Recommend raising INVENTORY_MISMATCH_MAX to 10 or 20.');
  } else {
    console.log('❓ MIXED RESULTS: Need further investigation');
    console.log('');
    console.log('   Neither theory fully explains the rejection rate.');
    console.log('   Review the detailed breakdown above.');
  }

  console.log('');
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
