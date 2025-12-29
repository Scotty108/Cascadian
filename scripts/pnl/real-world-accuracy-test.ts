/**
 * ============================================================================
 * REAL-WORLD ACCURACY TEST: V23c PnL vs Polymarket UI
 * ============================================================================
 *
 * PURPOSE: Test V23c PnL accuracy for the 16 wallets that PASSED TRADER_STRICT.
 *
 * METHODOLOGY:
 * 1. Load wallets that passed TRADER_STRICT from coverage test
 * 2. Load pre-scraped UI PnL values (from Playwright scrape)
 * 3. Calculate V23c PnL for each wallet using the canonical engine (UI Oracle)
 * 4. Compare and report accuracy metrics
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 *
 * V23c uses the UI Oracle (pm_market_metadata.outcome_prices) which should
 * match Polymarket UI exactly for TRADER_STRICT wallets.
 */

import { calculateV23cPnL, V23cResult } from '../../lib/pnl/shadowLedgerV23c';
import * as fs from 'fs';

// ============================================================================
// Configuration
// ============================================================================

const PROGRESS_FILE = 'data/real-world-coverage-progress.json';
const UI_SCRAPED_FILE = 'data/real-world-ui-pnl-scraped.json';
const SAVE_FILE = 'data/real-world-accuracy-results-v23c.json';
const PER_WALLET_TIMEOUT = 60000;

// ============================================================================
// Pre-scraped UI PnL values (from Playwright scrape on 2025-12-05)
// ============================================================================

const UI_PNL_MAP: Record<string, number> = {
  '0x4094d8961760ffd2d253e3e8eca633db6e23065a': -42.32,
  '0xf3efb90433670b5dec4fcbd7d5cee2bcd6873959': 0.45,
  '0x76a345e41842fc961098d58f893ee58c7096e4b9': -25.84,
  '0xdefb6fd2927beea366f06d0f5bae33243e1a29d4': -94.65,
  '0xddbb34babf2a7a66406351c5b0ed4433ef79a6a9': -0.87,
  '0x31ce1871c18bb2112432d77f6b3db5f0a6d02d9f': 11.10,
  '0x89d4601845f6da77555e00f7ed0782deeab901fb': -76.65,
  '0x54468955422da412126f2764ddc00002ef4c5f61': 0.41,
  '0xdb79523c7a8b6f48f84bf91311555d688bfb8d6a': 6.36,
  '0x3ed0219df8ca2d8bbf87c2c82e01ede883fa9a73': 0.45,
  '0x3e057f260a6970ce5430a7acdf5365372f2ba2ed': 260.19,
  '0xc3281dd1e4504feeb1e38cbd70cd559deaaf7edc': -1.34,
  '0xdcd7007b1a0b1e118684c47f6aaf8ba1b032a2d2': -293.91,
  '0xa3bf25c42944c5f929aa1f694faa7881e3dcf76b': -243.67,
  '0xc55bf083ca9e2be52b836d949f32d71c69703f8b': 1.66,
  '0x5b3c7fdc588f55ebe01cdfbba49df623919fb853': -3.41,
};

// ============================================================================
// Helper Functions
// ============================================================================

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label} after ${ms}ms`)), ms)
    ),
  ]);
};

// ============================================================================
// Main
// ============================================================================

interface AccuracyResult {
  wallet: string;
  v23c_pnl: number | null;
  v23c_realized: number | null;
  v23c_unrealized: number | null;
  ui_pnl: number | null;
  delta: number | null;
  delta_pct: number | null;
  within_5pct: boolean | null;
  within_10pct: boolean | null;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    REAL-WORLD ACCURACY TEST: V23c PnL vs Polymarket UI                               ║');
  console.log('║  Testing accuracy for wallets that PASSED TRADER_STRICT filter                                        ║');
  console.log('║  V23c Engine: Uses UI Oracle (pm_market_metadata.outcome_prices)                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  // Load wallets that passed TRADER_STRICT
  if (!fs.existsSync(PROGRESS_FILE)) {
    console.error(`ERROR: ${PROGRESS_FILE} not found. Run coverage test first.`);
    return;
  }

  const progressData = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  const traderStrictWallets = progressData.results
    .filter((r: any) => r.is_trader_strict)
    .map((r: any) => r.wallet);

  console.log(`Found ${traderStrictWallets.length} TRADER_STRICT wallets to test`);
  console.log('');

  // Test each wallet
  const results: AccuracyResult[] = [];
  let withinFivePct = 0;
  let withinTenPct = 0;
  let validComparisons = 0;

  console.log('═'.repeat(100));
  console.log('TESTING WALLETS WITH V23c ENGINE');
  console.log('═'.repeat(100));
  console.log('');

  for (let i = 0; i < traderStrictWallets.length; i++) {
    const wallet = traderStrictWallets[i];
    console.log(`[${i + 1}/${traderStrictWallets.length}] ${wallet.substring(0, 20)}...`);

    let result: AccuracyResult = {
      wallet,
      v23c_pnl: null,
      v23c_realized: null,
      v23c_unrealized: null,
      ui_pnl: null,
      delta: null,
      delta_pct: null,
      within_5pct: null,
      within_10pct: null,
    };

    try {
      // Calculate V23c PnL using the canonical engine with UI Oracle
      const v23c = await withTimeout(
        calculateV23cPnL(wallet, { useUIOracle: true }),
        PER_WALLET_TIMEOUT,
        'V23c PnL'
      );

      if (v23c) {
        result.v23c_pnl = v23c.totalPnl;
        result.v23c_realized = v23c.realizedPnl;
        result.v23c_unrealized = v23c.unrealizedPnl;
        console.log(`  V23c PnL: $${v23c.totalPnl.toFixed(2)} (realized: $${v23c.realizedPnl.toFixed(2)}, unrealized: $${v23c.unrealizedPnl.toFixed(2)})`);
      }

      // Get pre-scraped UI PnL
      const uiPnl = UI_PNL_MAP[wallet.toLowerCase()];
      if (uiPnl !== undefined) {
        result.ui_pnl = uiPnl;
        console.log(`  UI PnL:  $${uiPnl.toFixed(2)} (scraped via Playwright)`);

        // Calculate delta
        if (v23c) {
          const delta = v23c.totalPnl - uiPnl;
          // Use MAX(|v23c|, |ui|, 1) to avoid division issues
          const reference = Math.max(Math.abs(v23c.totalPnl), Math.abs(uiPnl), 1);
          const deltaPct = (Math.abs(delta) / reference) * 100;

          result.delta = delta;
          result.delta_pct = deltaPct;
          result.within_5pct = deltaPct <= 5;
          result.within_10pct = deltaPct <= 10;

          validComparisons++;
          if (deltaPct <= 5) withinFivePct++;
          if (deltaPct <= 10) withinTenPct++;

          const emoji = deltaPct <= 5 ? '✓' : deltaPct <= 10 ? '~' : '✗';
          console.log(`  Delta:   $${delta.toFixed(2)} (${deltaPct.toFixed(1)}%) ${emoji}`);
        }
      } else {
        console.log(`  UI PnL:  N/A (not in scraped data)`);
      }
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }

    results.push(result);
    console.log('');
  }

  // Save results
  fs.writeFileSync(SAVE_FILE, JSON.stringify({
    tested_at: new Date().toISOString(),
    engine: 'V23c (UI Oracle)',
    total_wallets: traderStrictWallets.length,
    valid_comparisons: validComparisons,
    within_5pct: withinFivePct,
    within_10pct: withinTenPct,
    results,
  }, null, 2));

  // Final report
  console.log('═'.repeat(100));
  console.log('FINAL ACCURACY RESULTS - V23c ENGINE');
  console.log('═'.repeat(100));
  console.log('');

  const accuracy5pct = validComparisons > 0 ? (withinFivePct / validComparisons) * 100 : 0;
  const accuracy10pct = validComparisons > 0 ? (withinTenPct / validComparisons) * 100 : 0;

  console.log(`  ╔════════════════════════════════════════════════════════════╗`);
  console.log(`  ║  V23c ACCURACY (within 5%):  ${accuracy5pct.toFixed(1).padStart(5)}% (${withinFivePct}/${validComparisons})           ║`);
  console.log(`  ║  V23c ACCURACY (within 10%): ${accuracy10pct.toFixed(1).padStart(5)}% (${withinTenPct}/${validComparisons})           ║`);
  console.log(`  ╚════════════════════════════════════════════════════════════╝`);
  console.log('');

  console.log('  BREAKDOWN:');
  console.log(`    Total TRADER_STRICT wallets: ${traderStrictWallets.length}`);
  console.log(`    Valid comparisons (UI data available): ${validComparisons}`);
  console.log(`    Within 5% tolerance: ${withinFivePct}`);
  console.log(`    Within 10% tolerance: ${withinTenPct}`);
  console.log('');

  // Show individual results table
  console.log('  INDIVIDUAL RESULTS:');
  console.log('  ' + '-'.repeat(100));
  console.log('  | Wallet                     | V23c PnL     | UI PnL       | Delta        | Delta %  | OK |');
  console.log('  ' + '-'.repeat(100));

  for (const r of results) {
    const walletShort = r.wallet.substring(0, 24) + '...';
    const v23c = r.v23c_pnl !== null ? `$${r.v23c_pnl.toFixed(2).padStart(9)}` : 'N/A'.padStart(10);
    const ui = r.ui_pnl !== null ? `$${r.ui_pnl.toFixed(2).padStart(9)}` : 'N/A'.padStart(10);
    const delta = r.delta !== null ? `$${r.delta.toFixed(2).padStart(9)}` : 'N/A'.padStart(10);
    const deltaPct = r.delta_pct !== null ? `${r.delta_pct.toFixed(1).padStart(6)}%` : 'N/A'.padStart(7);
    const ok = r.within_5pct === true ? '✓' : r.within_10pct === true ? '~' : r.delta_pct !== null ? '✗' : '-';

    console.log(`  | ${walletShort} | ${v23c} | ${ui} | ${delta} | ${deltaPct} | ${ok}  |`);
  }
  console.log('  ' + '-'.repeat(100));
  console.log('');

  // Verdict
  console.log('═'.repeat(100));
  console.log('VERDICT');
  console.log('═'.repeat(100));
  console.log('');

  if (validComparisons === 0) {
    console.log('⚠️ NO COMPARISONS: No UI PnL data available for these wallets.');
  } else if (accuracy5pct >= 80) {
    console.log('🎯 EXCELLENT: V23c PnL engine achieves >80% accuracy within 5% tolerance.');
  } else if (accuracy10pct >= 80) {
    console.log('✓ GOOD: V23c PnL engine achieves >80% accuracy within 10% tolerance.');
  } else if (accuracy10pct >= 50) {
    console.log('⚠️ MODERATE: V23c PnL engine achieves 50-80% accuracy.');
  } else {
    console.log('❌ POOR: V23c PnL engine accuracy is below 50%.');
  }

  console.log('');
  console.log(`Results saved to: ${SAVE_FILE}`);
  console.log('═'.repeat(100));
  console.log('Report signed: Claude 1');
  console.log('═'.repeat(100));
}

main().catch(console.error);
