/**
 * V23 FORENSIC DIAGNOSTIC SUITE
 *
 * PURPOSE: Classify every V23 failure into specific "Root Cause Buckets"
 * so we can fix them systematically.
 *
 * V23 STATUS: CLOB-only engine, achieves 62.5% pass rate (best so far)
 * BUT: 37.5% of wallets still fail. WHY?
 *
 * FAILURE CLASSIFICATION:
 * - Type A (The Holder): High unrealized_valuation_gap
 *   Fix: Implement Mark-to-Market in V23
 *
 * - Type B (The Ghost): High missing_clob_buys
 *   Fix: Data ingestion / "Phantom Leg" issue
 *
 * - Type C (The Gift): High has_transfers
 *   Fix: Handle ERC1155 cost basis (hard)
 *
 * - Type D (The Maker): High is_market_maker
 *   Fix: V27 Inventory Engine (but it failed)
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { calculateV23PnL, ShadowLedgerResult } from '../../lib/pnl/shadowLedgerV23';
import { clickhouse } from '../../lib/clickhouse/client';

// ============================================================================
// Types
// ============================================================================

interface BenchmarkWallet {
  wallet: string;
  ui_pnl: number;
}

interface WalletFingerprint {
  // Core identity
  wallet: string;
  ui_pnl: number;
  v23_pnl: number;
  error_pct: number;
  is_passing: boolean;

  // Feature flags (the "fingerprint")
  is_market_maker: boolean;      // Type D: has Splits > 0 OR Merges > 0
  has_transfers: boolean;        // Type C: incoming ERC1155 value > $1000
  has_open_positions: boolean;   // Type A: unrealized token exposure
  open_token_value_at_50: number;  // Value using 0.50 default
  open_token_value_at_1: number;   // Value using 1.0 (best case)
  unrealized_valuation_gap: number; // Type A indicator

  // Data quality flags
  missing_clob_buys: number;     // Type B: conditions with redemption but no CLOB buys
  total_conditions: number;
  ghost_ratio: number;           // missing_clob_buys / total_conditions

  // Activity counts
  clob_events: number;
  split_events: number;
  merge_events: number;
  redemption_events: number;
  transfer_in_value: number;

  // Classification
  classification: 'Type A' | 'Type B' | 'Type C' | 'Type D' | 'PASS' | 'UNKNOWN';
  primary_issue: string;
  recommended_fix: string;
}

// ============================================================================
// Helpers
// ============================================================================

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

function formatPnL(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ============================================================================
// Data Loading
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

async function collectFingerprint(wallet: string, ui_pnl: number): Promise<WalletFingerprint> {
  // Step 1: Run V23 PnL
  const v23Result = await calculateV23PnL(wallet);
  const v23_pnl = v23Result.totalPnl;
  const error_pct = errorPct(v23_pnl, ui_pnl);
  const is_passing = error_pct < 1.0; // 1% threshold for traders

  // Step 2: Get activity counts from pm_unified_ledger_v7
  const activityQuery = `
    SELECT
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PositionSplit') as split_events,
      countIf(source_type = 'PositionsMerge') as merge_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
  `;
  const activityResult = await clickhouse.query({ query: activityQuery, format: 'JSONEachRow' });
  const activityRows = (await activityResult.json()) as any[];
  const activity = activityRows[0] || { clob_events: 0, split_events: 0, merge_events: 0, redemption_events: 0 };

  // Step 3: Check for open positions (unresolved markets with token balance)
  const openPositionsQuery = `
    WITH wallet_positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(token_delta) as token_balance
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
      HAVING abs(sum(token_delta)) > 100
    ),
    resolved_conditions AS (
      SELECT DISTINCT lower(condition_id) as condition_id
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_numerators IS NOT NULL
        AND payout_numerators != ''
        AND payout_numerators != '[]'
    )
    SELECT
      count() as open_positions,
      sum(abs(token_balance)) as total_tokens
    FROM wallet_positions wp
    LEFT JOIN resolved_conditions rc ON lower(wp.condition_id) = rc.condition_id
    WHERE rc.condition_id IS NULL
  `;
  const openResult = await clickhouse.query({ query: openPositionsQuery, format: 'JSONEachRow' });
  const openRows = (await openResult.json()) as any[];
  const openData = openRows[0] || { open_positions: 0, total_tokens: 0 };
  const has_open_positions = Number(openData.open_positions) > 0;
  const total_open_tokens = Number(openData.total_tokens) || 0;
  const open_token_value_at_50 = total_open_tokens * 0.5;
  const open_token_value_at_1 = total_open_tokens * 1.0;
  const unrealized_valuation_gap = Math.abs(open_token_value_at_1 - open_token_value_at_50);

  // Step 4: Check for "ghost" conditions (redemption with no CLOB buys)
  const ghostQuery = `
    WITH redemption_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'PayoutRedemption'
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    clob_buy_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND token_delta > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    all_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
    )
    SELECT
      (SELECT count() FROM redemption_conditions r
       LEFT JOIN clob_buy_conditions c ON lower(r.condition_id) = lower(c.condition_id)
       WHERE c.condition_id IS NULL) as missing_clob_buys,
      (SELECT count() FROM all_conditions) as total_conditions
  `;
  const ghostResult = await clickhouse.query({ query: ghostQuery, format: 'JSONEachRow' });
  const ghostRows = (await ghostResult.json()) as any[];
  const ghostData = ghostRows[0] || { missing_clob_buys: 0, total_conditions: 0 };
  const missing_clob_buys = Number(ghostData.missing_clob_buys) || 0;
  const total_conditions = Number(ghostData.total_conditions) || 1;
  const ghost_ratio = missing_clob_buys / total_conditions;

  // Step 5: Check for incoming ERC1155 transfers (gifts)
  // Look in pm_ctf_events for TransferSingle where user receives tokens
  const transferQuery = `
    SELECT
      sum(CASE
        WHEN event_type = 'TransferSingle' AND toFloat64(amount_or_payout) > 0
        THEN toFloat64(amount_or_payout)
        ELSE 0
      END) as transfer_in_value
    FROM pm_ctf_events
    WHERE lower(to_address) = lower('${wallet}')
      AND lower(from_address) != lower('${wallet}')
      AND is_deleted = 0
      AND event_type = 'TransferSingle'
  `;
  let transfer_in_value = 0;
  try {
    const transferResult = await clickhouse.query({ query: transferQuery, format: 'JSONEachRow' });
    const transferRows = (await transferResult.json()) as any[];
    transfer_in_value = Number(transferRows[0]?.transfer_in_value) || 0;
  } catch {
    // Table might not exist or query might fail
  }
  const has_transfers = transfer_in_value > 1000;

  // Classify wallet
  const is_market_maker = Number(activity.split_events) > 0 || Number(activity.merge_events) > 10;

  // Determine classification based on strongest signal
  let classification: WalletFingerprint['classification'] = 'UNKNOWN';
  let primary_issue = '';
  let recommended_fix = '';

  if (is_passing) {
    classification = 'PASS';
    primary_issue = 'None';
    recommended_fix = 'N/A';
  } else if (unrealized_valuation_gap > Math.abs(ui_pnl - v23_pnl) * 0.5 && has_open_positions) {
    classification = 'Type A';
    primary_issue = `Open positions valued at $0.50, gap = $${formatPnL(unrealized_valuation_gap)}`;
    recommended_fix = 'Implement Mark-to-Market pricing for unresolved positions';
  } else if (ghost_ratio > 0.1 && missing_clob_buys > 5) {
    classification = 'Type B';
    primary_issue = `${missing_clob_buys} conditions with redemption but no CLOB buys (${(ghost_ratio * 100).toFixed(1)}%)`;
    recommended_fix = 'Fix data ingestion / phantom leg issue';
  } else if (has_transfers && transfer_in_value > Math.abs(ui_pnl - v23_pnl) * 0.3) {
    classification = 'Type C';
    primary_issue = `Received $${formatPnL(transfer_in_value)} in ERC1155 transfers`;
    recommended_fix = 'Handle ERC1155 cost basis attribution (complex)';
  } else if (is_market_maker) {
    classification = 'Type D';
    primary_issue = `Market Maker with ${activity.split_events} splits, ${activity.merge_events} merges`;
    recommended_fix = 'Use inventory-based engine (V27 series) - requires further development';
  } else {
    classification = 'UNKNOWN';
    primary_issue = 'No clear pattern detected';
    recommended_fix = 'Manual investigation required';
  }

  return {
    wallet,
    ui_pnl,
    v23_pnl,
    error_pct,
    is_passing,

    is_market_maker,
    has_transfers,
    has_open_positions,
    open_token_value_at_50,
    open_token_value_at_1,
    unrealized_valuation_gap,

    missing_clob_buys,
    total_conditions,
    ghost_ratio,

    clob_events: Number(activity.clob_events) || 0,
    split_events: Number(activity.split_events) || 0,
    merge_events: Number(activity.merge_events) || 0,
    redemption_events: Number(activity.redemption_events) || 0,
    transfer_in_value,

    classification,
    primary_issue,
    recommended_fix,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                              V23 FORENSIC DIAGNOSTIC SUITE                                                                       ║');
  console.log('║  MISSION: Classify every V23 failure into specific Root Cause Buckets                                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('Benchmark Set: fresh_2025_12_04_alltime');
  console.log('');

  // Load wallets
  const wallets = await loadBenchmarkWallets();
  console.log(`Loaded ${wallets.length} wallets from benchmark`);
  console.log('');

  // Process each wallet
  const fingerprints: WalletFingerprint[] = [];
  const typeCounters = { 'Type A': 0, 'Type B': 0, 'Type C': 0, 'Type D': 0, 'PASS': 0, 'UNKNOWN': 0 };

  console.log('Processing wallets...');
  console.log('');

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    try {
      process.stdout.write(`\r[${i + 1}/${wallets.length}] ${w.wallet.substring(0, 12)}...`);
      const fp = await collectFingerprint(w.wallet, w.ui_pnl);
      fingerprints.push(fp);
      typeCounters[fp.classification]++;
    } catch (err: any) {
      console.log(`\n⚠️ Error processing ${w.wallet}: ${err.message}`);
    }
  }
  console.log('\n');

  // ============================================================================
  // REPORT: Summary
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('CLASSIFICATION SUMMARY');
  console.log('═'.repeat(140));
  console.log('');
  console.log(`PASS:    ${typeCounters['PASS'].toString().padStart(3)} wallets (V23 error < 1%)`);
  console.log(`Type A:  ${typeCounters['Type A'].toString().padStart(3)} wallets (The Holder - unrealized valuation gap)`);
  console.log(`Type B:  ${typeCounters['Type B'].toString().padStart(3)} wallets (The Ghost - missing CLOB buys for redemptions)`);
  console.log(`Type C:  ${typeCounters['Type C'].toString().padStart(3)} wallets (The Gift - ERC1155 transfers received)`);
  console.log(`Type D:  ${typeCounters['Type D'].toString().padStart(3)} wallets (The Maker - uses Split/Merge)`);
  console.log(`UNKNOWN: ${typeCounters['UNKNOWN'].toString().padStart(3)} wallets (needs manual investigation)`);
  console.log('');

  // ============================================================================
  // REPORT: Failure Details Table
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('FAILURE CLASSIFICATION DETAILS');
  console.log('═'.repeat(140));
  console.log('');
  console.log(
    'Wallet'.padEnd(14) +
    'Error %'.padStart(10) +
    'Type'.padStart(10) +
    'UI PnL'.padStart(14) +
    'V23 PnL'.padStart(14) +
    'Gap'.padStart(12) +
    'Recommended Fix'.padStart(60)
  );
  console.log('-'.repeat(140));

  const failures = fingerprints.filter(fp => !fp.is_passing).sort((a, b) => b.error_pct - a.error_pct);

  for (const fp of failures) {
    const gap = fp.ui_pnl - fp.v23_pnl;
    console.log(
      fp.wallet.substring(0, 12).padEnd(14) +
      `${fp.error_pct.toFixed(1)}%`.padStart(10) +
      fp.classification.padStart(10) +
      formatPnL(fp.ui_pnl).padStart(14) +
      formatPnL(fp.v23_pnl).padStart(14) +
      formatPnL(gap).padStart(12) +
      fp.recommended_fix.substring(0, 58).padStart(60)
    );
  }
  console.log('');

  // ============================================================================
  // REPORT: Recommended Actions by Type
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('RECOMMENDED ACTIONS BY FAILURE TYPE');
  console.log('═'.repeat(140));
  console.log('');

  // Type A
  const typeA = fingerprints.filter(fp => fp.classification === 'Type A');
  if (typeA.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ TYPE A (The Holder): ' + typeA.length + ' wallets                                                                                                            │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ PROBLEM: V23 values open positions at $0.50 (default). Actual market prices differ.                                                     │');
    console.log('│ FIX: Implement Mark-to-Market pricing using last trade price or order book midpoint.                                                    │');
    console.log('│ ESTIMATED EFFORT: Low-Medium (need price oracle integration)                                                                             │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Affected wallets:');
    for (const fp of typeA.slice(0, 5)) {
      console.log(`    ${fp.wallet.substring(0, 12)}... | Unrealized Gap: $${formatPnL(fp.unrealized_valuation_gap)} | Open Tokens: ${fp.open_token_value_at_50.toFixed(0)}`);
    }
    if (typeA.length > 5) console.log(`    ... and ${typeA.length - 5} more`);
    console.log('');
  }

  // Type B
  const typeB = fingerprints.filter(fp => fp.classification === 'Type B');
  if (typeB.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ TYPE B (The Ghost): ' + typeB.length + ' wallets                                                                                                             │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ PROBLEM: Redemptions exist without corresponding CLOB buys - phantom legs.                                                              │');
    console.log('│ FIX: Investigate data ingestion. Check if CLOB trades are missing from pm_trader_events_v2 or pm_unified_ledger_v7.                    │');
    console.log('│ ESTIMATED EFFORT: Medium-High (data pipeline investigation)                                                                              │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Affected wallets:');
    for (const fp of typeB.slice(0, 5)) {
      console.log(`    ${fp.wallet.substring(0, 12)}... | Missing CLOB: ${fp.missing_clob_buys}/${fp.total_conditions} conditions (${(fp.ghost_ratio * 100).toFixed(1)}%)`);
    }
    if (typeB.length > 5) console.log(`    ... and ${typeB.length - 5} more`);
    console.log('');
  }

  // Type C
  const typeC = fingerprints.filter(fp => fp.classification === 'Type C');
  if (typeC.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ TYPE C (The Gift): ' + typeC.length + ' wallets                                                                                                              │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ PROBLEM: ERC1155 transfers received (gifts/internal transfers). No cost basis.                                                          │');
    console.log('│ FIX: Track ERC1155 TransferSingle events and attribute cost basis (complex).                                                            │');
    console.log('│ ESTIMATED EFFORT: High (requires cost basis tracking for free tokens)                                                                    │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Affected wallets:');
    for (const fp of typeC.slice(0, 5)) {
      console.log(`    ${fp.wallet.substring(0, 12)}... | Transfer Value: $${formatPnL(fp.transfer_in_value)}`);
    }
    if (typeC.length > 5) console.log(`    ... and ${typeC.length - 5} more`);
    console.log('');
  }

  // Type D
  const typeD = fingerprints.filter(fp => fp.classification === 'Type D');
  if (typeD.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ TYPE D (The Maker): ' + typeD.length + ' wallets                                                                                                             │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ PROBLEM: Uses Split/Merge operations. V23 CLOB-only misses this activity.                                                               │');
    console.log('│ FIX: Inventory-based engine (V27 series). NOTE: V27b/V28 both failed on these wallets.                                                   │');
    console.log('│ ESTIMATED EFFORT: High (fundamental engine redesign required)                                                                            │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Affected wallets:');
    for (const fp of typeD.slice(0, 5)) {
      console.log(`    ${fp.wallet.substring(0, 12)}... | Splits: ${fp.split_events}, Merges: ${fp.merge_events}, CLOB: ${fp.clob_events}`);
    }
    if (typeD.length > 5) console.log(`    ... and ${typeD.length - 5} more`);
    console.log('');
  }

  // UNKNOWN
  const unknowns = fingerprints.filter(fp => fp.classification === 'UNKNOWN');
  if (unknowns.length > 0) {
    console.log('┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ UNKNOWN: ' + unknowns.length + ' wallets                                                                                                                      │');
    console.log('├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log('│ PROBLEM: No clear pattern detected - requires manual investigation.                                                                     │');
    console.log('└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Affected wallets:');
    for (const fp of unknowns.slice(0, 5)) {
      console.log(`    ${fp.wallet.substring(0, 12)}... | Error: ${fp.error_pct.toFixed(1)}% | CLOB: ${fp.clob_events}, Splits: ${fp.split_events}, Ghosts: ${fp.missing_clob_buys}`);
    }
    if (unknowns.length > 5) console.log(`    ... and ${unknowns.length - 5} more`);
    console.log('');
  }

  // ============================================================================
  // REPORT: Priority Matrix
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('PRIORITY MATRIX');
  console.log('═'.repeat(140));
  console.log('');
  console.log('  Priority | Type   | Count | Effort     | Impact (if fixed)');
  console.log('  ---------|--------|-------|------------|-------------------');

  // Calculate total error per type
  const typeAError = typeA.reduce((sum, fp) => sum + Math.abs(fp.ui_pnl - fp.v23_pnl), 0);
  const typeBError = typeB.reduce((sum, fp) => sum + Math.abs(fp.ui_pnl - fp.v23_pnl), 0);
  const typeCError = typeC.reduce((sum, fp) => sum + Math.abs(fp.ui_pnl - fp.v23_pnl), 0);
  const typeDError = typeD.reduce((sum, fp) => sum + Math.abs(fp.ui_pnl - fp.v23_pnl), 0);

  const priorities = [
    { type: 'Type A', count: typeA.length, effort: 'Low-Med', impact: typeAError },
    { type: 'Type B', count: typeB.length, effort: 'Med-High', impact: typeBError },
    { type: 'Type C', count: typeC.length, effort: 'High', impact: typeCError },
    { type: 'Type D', count: typeD.length, effort: 'High', impact: typeDError },
  ].sort((a, b) => (b.impact / (a.effort === 'Low-Med' ? 1 : a.effort === 'Med-High' ? 2 : 3)) -
                   (a.impact / (b.effort === 'Low-Med' ? 1 : b.effort === 'Med-High' ? 2 : 3)));

  let priority = 1;
  for (const p of priorities) {
    if (p.count > 0) {
      console.log(`  ${priority.toString().padEnd(9)}| ${p.type.padEnd(7)}| ${p.count.toString().padEnd(6)}| ${p.effort.padEnd(11)}| $${formatPnL(p.impact)} total gap`);
      priority++;
    }
  }
  console.log('');

  // ============================================================================
  // REPORT: Final Stats
  // ============================================================================
  console.log('═'.repeat(140));
  console.log('FINAL STATISTICS');
  console.log('═'.repeat(140));
  console.log('');
  console.log(`  Total Wallets:    ${fingerprints.length}`);
  console.log(`  Passing (< 1%):   ${typeCounters['PASS']} (${((typeCounters['PASS'] / fingerprints.length) * 100).toFixed(1)}%)`);
  console.log(`  Failing:          ${failures.length} (${((failures.length / fingerprints.length) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('  Classified Failures:');
  console.log(`    Type A (Holder):   ${typeA.length} → Mark-to-Market fix needed`);
  console.log(`    Type B (Ghost):    ${typeB.length} → Data ingestion fix needed`);
  console.log(`    Type C (Gift):     ${typeC.length} → ERC1155 cost basis needed`);
  console.log(`    Type D (Maker):    ${typeD.length} → Inventory engine needed`);
  console.log(`    Unknown:           ${unknowns.length} → Manual investigation`);
  console.log('');

  console.log('═'.repeat(140));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(140));
}

main().catch(console.error);
