/**
 * ============================================================================
 * REAL-WORLD COVERAGE TEST: TRADER_STRICT RATE FOR NORMAL USERS
 * ============================================================================
 *
 * PURPOSE: Test TRADER_STRICT pass rate on random recent traders, NOT whales.
 *
 * HYPOTHESIS: Normal users should have >80% TRADER_STRICT rate since they
 *             don't use Split/Merge (market making) operations.
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { isTraderStrict, TRADER_STRICT_THRESHOLDS } from '../../lib/pnl/walletClassifier';
import * as fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const SAMPLE_SIZE = 50; // Reduced from 100 for faster execution
const SAVE_FILE = 'data/real-world-coverage-progress.json';

// ============================================================================
// Progress Tracking
// ============================================================================

interface WalletResult {
  wallet: string;
  is_trader_strict: boolean;
  rejection_reason?: string;
  timestamp: string;
}

interface ProgressData {
  started_at: string;
  sample_size: number;
  processed: number;
  trader_strict_count: number;
  reject_count: number;
  results: WalletResult[];
  rejection_reasons: Record<string, number>;
}

function saveProgress(progress: ProgressData) {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(SAVE_FILE, JSON.stringify(progress, null, 2));
}

function printLiveStats(progress: ProgressData) {
  const passRate = progress.processed > 0
    ? ((progress.trader_strict_count / progress.processed) * 100).toFixed(1)
    : '0.0';

  console.log('');
  console.log(`  ┌─────────────────────────────────────────────────┐`);
  console.log(`  │  LIVE STATS: ${progress.processed}/${progress.sample_size} wallets processed         │`);
  console.log(`  │  PASS RATE: ${passRate}% TRADER_STRICT                  │`);
  console.log(`  │  PASSED: ${progress.trader_strict_count}  |  REJECTED: ${progress.reject_count}                    │`);
  console.log(`  └─────────────────────────────────────────────────┘`);

  if (Object.keys(progress.rejection_reasons).length > 0) {
    console.log('  Rejection breakdown:');
    for (const [reason, count] of Object.entries(progress.rejection_reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason.padEnd(20)} ${count}`);
    }
  }
  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    REAL-WORLD COVERAGE TEST: TRADER_STRICT RATE                                       ║');
  console.log('║  Testing on Random Recent Traders (NOT All-Time Leaderboard Whales)                                   ║');
  console.log('║  ** LIVE PROGRESS - Results saved to data/real-world-coverage-progress.json **                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Sample Size: ${SAMPLE_SIZE}`);
  console.log('');

  // Show thresholds
  console.log('═'.repeat(100));
  console.log('TRADER_STRICT THRESHOLDS');
  console.log('═'.repeat(100));
  console.log(`  INVENTORY_MISMATCH_MAX: ${TRADER_STRICT_THRESHOLDS.INVENTORY_MISMATCH_MAX} tokens`);
  console.log(`  TRANSFER_IN_VALUE_MAX: $${TRADER_STRICT_THRESHOLDS.TRANSFER_IN_VALUE_MAX}`);
  console.log(`  SPLIT_EVENTS_MAX: ${TRADER_STRICT_THRESHOLDS.SPLIT_EVENTS_MAX}`);
  console.log(`  MERGE_EVENTS_MAX: ${TRADER_STRICT_THRESHOLDS.MERGE_EVENTS_MAX}`);
  console.log('');

  // Initialize progress
  const progress: ProgressData = {
    started_at: new Date().toISOString(),
    sample_size: SAMPLE_SIZE,
    processed: 0,
    trader_strict_count: 0,
    reject_count: 0,
    results: [],
    rejection_reasons: {},
  };

  // Step 1: Get random wallets from recent trades
  console.log('═'.repeat(100));
  console.log('STEP 1: FETCHING RANDOM RECENT TRADERS');
  console.log('═'.repeat(100));
  console.log('');

  const sampleQuery = `
    SELECT DISTINCT trader_wallet as wallet
    FROM pm_trader_events_v2
    WHERE trade_time >= now() - INTERVAL 7 DAY
      AND trader_wallet != ''
      AND is_deleted = 0
    ORDER BY rand()
    LIMIT ${SAMPLE_SIZE}
  `;

  console.log('Querying pm_trader_events_v2 for recent traders...');
  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleWallets = (await sampleResult.json()) as any[];

  if (sampleWallets.length === 0) {
    console.log('WARNING: No wallets in last 7 days. Trying last 30 days...');

    const fallbackQuery = `
      SELECT DISTINCT trader_wallet as wallet
      FROM pm_trader_events_v2
      WHERE trade_time >= now() - INTERVAL 30 DAY
        AND trader_wallet != ''
        AND is_deleted = 0
      ORDER BY rand()
      LIMIT ${SAMPLE_SIZE}
    `;

    const fallbackResult = await clickhouse.query({ query: fallbackQuery, format: 'JSONEachRow' });
    const fallbackWallets = (await fallbackResult.json()) as any[];

    if (fallbackWallets.length === 0) {
      console.log('ERROR: No wallets found at all. Check pm_trader_events_v2 data.');
      return;
    }

    sampleWallets.push(...fallbackWallets);
  }

  console.log(`Fetched ${sampleWallets.length} random recent traders`);
  console.log('');

  // Step 2: Classify each wallet with live progress
  console.log('═'.repeat(100));
  console.log('STEP 2: CLASSIFYING WALLETS (LIVE PROGRESS)');
  console.log('═'.repeat(100));

  // Helper: wrap with timeout
  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT: ${label} after ${ms}ms`)), ms)
      ),
    ]);
  };

  const PER_WALLET_TIMEOUT = 30000; // 30 seconds per wallet

  for (let i = 0; i < sampleWallets.length; i++) {
    const w = sampleWallets[i];
    console.log(`\n[${i + 1}/${sampleWallets.length}] Classifying: ${w.wallet.substring(0, 20)}...`);

    let walletResult: WalletResult = {
      wallet: w.wallet,
      is_trader_strict: false,
      timestamp: new Date().toISOString(),
    };

    try {
      const result = await withTimeout(
        isTraderStrict(w.wallet),
        PER_WALLET_TIMEOUT,
        `wallet ${w.wallet.substring(0, 10)}`
      );

      if (result.is_trader_strict) {
        progress.trader_strict_count++;
        walletResult.is_trader_strict = true;
        console.log(`  ✓ TRADER_STRICT (pass)`);
      } else {
        progress.reject_count++;

        // Categorize rejection reason
        let reason: string;
        if (result.activity.split_events > 0) {
          reason = result.activity.split_events > 10 ? 'SPLITS (>10)' : 'SPLITS (1-10)';
        } else if (result.activity.merge_events > 0) {
          reason = result.activity.merge_events > 10 ? 'MERGES (>10)' : 'MERGES (1-10)';
        } else if (!result.inventory.is_consistent) {
          const gap = result.inventory.inventory_mismatch;
          if (gap <= 10) reason = 'INV GAP (5-10)';
          else if (gap <= 50) reason = 'INV GAP (10-50)';
          else reason = 'INV GAP (>50)';
        } else if (result.transfers.is_transfer_heavy) {
          reason = 'TRANSFER HEAVY';
        } else {
          reason = 'OTHER';
        }

        walletResult.rejection_reason = reason;
        progress.rejection_reasons[reason] = (progress.rejection_reasons[reason] || 0) + 1;
        console.log(`  ✗ REJECTED: ${reason}`);
      }
    } catch (err: any) {
      progress.reject_count++;
      const errMsg = err.message?.includes('TIMEOUT') ? 'TIMEOUT' : 'ERROR';
      walletResult.rejection_reason = errMsg;
      progress.rejection_reasons[errMsg] = (progress.rejection_reasons[errMsg] || 0) + 1;
      console.log(`  ✗ ${errMsg}`);
    }

    progress.processed++;
    progress.results.push(walletResult);

    // Save progress and print live stats every 5 wallets
    if (progress.processed % 5 === 0 || progress.processed === sampleWallets.length) {
      saveProgress(progress);
      printLiveStats(progress);
    }
  }

  // Final save
  saveProgress(progress);

  // Step 3: Report results
  console.log('');
  console.log('═'.repeat(100));
  console.log('FINAL RESULTS');
  console.log('═'.repeat(100));
  console.log('');

  const passRate = (progress.trader_strict_count / sampleWallets.length) * 100;
  const rejectRate = 100 - passRate;

  console.log(`  ╔════════════════════════════════════════════════╗`);
  console.log(`  ║  REAL-WORLD TRADER_STRICT PASS RATE: ${passRate.toFixed(1).padStart(5)}%  ║`);
  console.log(`  ╚════════════════════════════════════════════════╝`);
  console.log('');

  console.log('  BREAKDOWN:');
  console.log(`    TRADER_STRICT:   ${progress.trader_strict_count.toString().padStart(3)} / ${sampleWallets.length} (${passRate.toFixed(1)}%)`);
  console.log(`    REJECTED:        ${progress.reject_count.toString().padStart(3)} / ${sampleWallets.length} (${rejectRate.toFixed(1)}%)`);
  console.log('');

  console.log('  REJECTION REASONS:');
  const sortedReasons = Object.entries(progress.rejection_reasons).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons) {
    console.log(`    ${reason.padEnd(20)} ${count.toString().padStart(3)} wallets`);
  }
  console.log('');

  // Comparison
  console.log('═'.repeat(100));
  console.log('COMPARISON: ALL-TIME LEADERBOARD vs REAL-WORLD');
  console.log('═'.repeat(100));
  console.log('');

  const leaderboardRate = 20.0; // 8/40 from benchmark
  console.log(`  All-Time Leaderboard:   ${leaderboardRate.toFixed(1)}% TRADER_STRICT (8/40)`);
  console.log(`  Real-World Sample:      ${passRate.toFixed(1)}% TRADER_STRICT (${progress.trader_strict_count}/${sampleWallets.length})`);
  console.log('');

  if (passRate > 60) {
    console.log('  ✓ GOOD: Real-world pass rate is healthy (>60%)');
    console.log('    The 80% rejection on Leaderboard is due to DATASET BIAS (whales/makers).');
  } else if (passRate > 40) {
    console.log('  ⚠️ MODERATE: Pass rate is lower than expected (40-60%)');
    console.log('    May need to investigate common rejection reasons.');
  } else {
    console.log('  ✗ PROBLEM: Pass rate is too low (<40%)');
    console.log('    The filter may be too strict. Review thresholds.');
  }

  console.log('');

  // Verdict
  console.log('═'.repeat(100));
  console.log('VERDICT');
  console.log('═'.repeat(100));
  console.log('');

  if (passRate >= 70) {
    console.log('🎯 CONCLUSION: The 80% rejection rate on All-Time Leaderboard is EXPECTED.');
    console.log('');
    console.log('   The Leaderboard is dominated by Market Makers and whales who use');
    console.log('   Split/Merge operations. Real-world users have a much higher pass rate.');
    console.log('');
    console.log('   RECOMMENDATION: No filter changes needed.');
  } else if (passRate >= 50) {
    console.log('⚠️ CONCLUSION: Filter is working but may be slightly strict.');
    console.log('');
    console.log('   Consider relaxing thresholds if you want higher coverage.');
    console.log('   Most common rejection reasons shown above.');
  } else {
    console.log('❌ CONCLUSION: Filter may be too strict for production use.');
    console.log('');
    console.log('   With only ' + passRate.toFixed(0) + '% of users passing, the TRADER_STRICT');
    console.log('   cohort may be too small for practical use.');
    console.log('');
    console.log('   RECOMMENDATION: Review and relax thresholds.');
  }

  console.log('');
  console.log(`Progress saved to: ${SAVE_FILE}`);
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
