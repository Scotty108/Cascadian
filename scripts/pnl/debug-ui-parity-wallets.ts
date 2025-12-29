/**
 * Debug UI Parity for Problem Wallets (W1, W5, W6)
 *
 * Deep investigation of why these wallets diverge from UI metrics.
 * Uses the debug decomposition from computeWalletActivityPnlV3Debug.
 *
 * Usage: npx tsx scripts/pnl/debug-ui-parity-wallets.ts
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl';
import { UI_BENCHMARK_WALLETS, type UIBenchmarkWallet } from './ui-benchmark-constants';

// Focus on problem wallets
const PROBLEM_WALLETS = ['W1', 'W5', 'W6'];

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return n.toFixed(1) + '%';
}

function calcErrorPct(computed: number, ui: number): number {
  return (Math.abs(computed - ui) / (Math.abs(ui) + 1e-9)) * 100;
}

async function analyzeWallet(bm: UIBenchmarkWallet): Promise<void> {
  console.log('='.repeat(100));
  console.log(`${bm.label} (${bm.wallet})`);
  console.log('='.repeat(100));
  console.log('');

  const m = await computeWalletActivityPnlV3Debug(bm.wallet);

  // Section 1: UI vs Ours comparison
  console.log('METRIC COMPARISON (UI vs Ours):');
  console.log('-'.repeat(60));
  console.log(
    `  PnL:    UI=${formatNumber(bm.profitLoss_all).padStart(12)}, ours=${formatNumber(m.pnl_activity_total).padStart(12)}, err=${formatPct(calcErrorPct(m.pnl_activity_total, bm.profitLoss_all)).padStart(8)}`
  );
  console.log(
    `  Vol:    UI=${formatNumber(bm.volume_all).padStart(12)}, ours=${formatNumber(m.volume_traded).padStart(12)}, err=${formatPct(calcErrorPct(m.volume_traded, bm.volume_all)).padStart(8)}`
  );
  console.log(
    `  Gain:   UI=${formatNumber(bm.gain_all).padStart(12)}, ours=${formatNumber(m.gain_activity).padStart(12)}, err=${formatPct(calcErrorPct(m.gain_activity, bm.gain_all)).padStart(8)}`
  );
  console.log(
    `  Loss:   UI=${formatNumber(bm.loss_all).padStart(12)}, ours=${formatNumber(m.loss_activity).padStart(12)}, err=${formatPct(calcErrorPct(m.loss_activity, bm.loss_all)).padStart(8)}`
  );
  console.log('');

  // Section 2: PnL Decomposition by Source
  console.log('PNL DECOMPOSITION BY SOURCE:');
  console.log('-'.repeat(60));
  console.log(`  PnL from CLOB sells:       $${formatNumber(m.pnl_from_clob)}`);
  console.log(`  PnL from Redemptions:      $${formatNumber(m.pnl_from_redemptions)}`);
  console.log(`  PnL from Resolution:       $${formatNumber(m.pnl_from_resolution_losses)}`);
  console.log(`  ----------------------------------------`);
  const sum = m.pnl_from_clob + m.pnl_from_redemptions + m.pnl_from_resolution_losses;
  console.log(`  Total (sum):               $${formatNumber(sum)}`);
  console.log(`  pnl_activity_total:        $${formatNumber(m.pnl_activity_total)}`);
  console.log(`  Match: ${Math.abs(sum - m.pnl_activity_total) < 0.01 ? 'YES' : 'NO'}`);
  console.log('');

  // Section 3: Event Counts
  console.log('EVENT COUNTS:');
  console.log('-'.repeat(60));
  console.log(`  Total CLOB events:         ${m.fills_count}`);
  console.log(`    - Buys:                  ${m.clob_buy_count}`);
  console.log(`    - Sells:                 ${m.clob_sell_count}`);
  console.log(`  Redemption events:         ${m.redemptions_count}`);
  console.log(`  Resolution loss events:    ${m.resolution_loss_events}`);
  console.log(`  Total events:              ${m.total_events}`);
  console.log(`  Outcomes traded:           ${m.outcomes_traded}`);
  console.log('');

  // Section 4: Volume Breakdown
  console.log('VOLUME BREAKDOWN:');
  console.log('-'.repeat(60));
  console.log(`  Volume from buys:          $${formatNumber(m.volume_buys)}`);
  console.log(`  Volume from sells:         $${formatNumber(m.volume_sells)}`);
  console.log(`  Total volume (our calc):   $${formatNumber(m.volume_traded)}`);
  console.log(`  UI volume:                 $${formatNumber(bm.volume_all)}`);
  const vol_diff = m.volume_traded - bm.volume_all;
  console.log(`  Difference:                $${formatNumber(vol_diff)} (${vol_diff > 0 ? 'we count MORE' : 'we count LESS'})`);
  console.log('');

  // Section 5: Unredeemed Position Stats
  console.log('UNREDEEMED POSITION STATS:');
  console.log('-'.repeat(60));
  console.log(`  Conditions with unredeemed WINNERS: ${m.conditions_with_unredeemed_winners}`);
  console.log(`  Conditions with unredeemed LOSERS:  ${m.conditions_with_unredeemed_losers}`);
  console.log('');

  // Section 6: Analysis and Hypotheses
  console.log('ANALYSIS:');
  console.log('-'.repeat(60));

  // Volume analysis
  if (Math.abs(m.volume_traded - bm.volume_all) / bm.volume_all > 0.1) {
    if (m.volume_traded < bm.volume_all) {
      console.log(`  - Volume is LOWER than UI by $${formatNumber(bm.volume_all - m.volume_traded)}`);
      console.log(`    Hypothesis: UI might count redemption payouts as volume, or AMM trades`);
    } else {
      console.log(`  - Volume is HIGHER than UI by $${formatNumber(m.volume_traded - bm.volume_all)}`);
      console.log(`    Hypothesis: We might be double-counting some trades`);
    }
  }

  // Gain/Loss analysis
  if (m.gain_activity > bm.gain_all * 1.5) {
    console.log(`  - Gain is MUCH HIGHER than UI (+${formatPct((m.gain_activity / bm.gain_all - 1) * 100)})`);
    console.log(`    Hypothesis: We are realizing gains that UI doesn't (e.g., unredeemed winners)`);
  }
  if (Math.abs(m.loss_activity) > Math.abs(bm.loss_all) * 1.5) {
    console.log(`  - Loss is MUCH HIGHER than UI (+${formatPct((Math.abs(m.loss_activity) / Math.abs(bm.loss_all) - 1) * 100)})`);
    console.log(`    Hypothesis: We are realizing losses that UI doesn't`);
  }

  // Resolution-based PnL analysis
  if (Math.abs(m.pnl_from_resolution_losses) > 100) {
    if (m.pnl_from_resolution_losses > 0) {
      console.log(`  - Resolution-based PnL is POSITIVE: $${formatNumber(m.pnl_from_resolution_losses)}`);
      console.log(`    This means we're realizing unredeemed WINNERS (UI may not do this)`);
    } else {
      console.log(`  - Resolution-based PnL is NEGATIVE: $${formatNumber(m.pnl_from_resolution_losses)}`);
      console.log(`    This means we're realizing unredeemed LOSERS (correct behavior)`);
    }
  }

  // Check if redemptions dominate
  if (Math.abs(m.pnl_from_redemptions) > Math.abs(m.pnl_from_clob) * 2) {
    console.log(`  - Redemption PnL dominates CLOB PnL`);
    console.log(`    Most of this wallet's realized PnL comes from redeeming positions`);
  }

  console.log('');
  console.log('');
}

async function main(): Promise<void> {
  console.log('='.repeat(100));
  console.log('DEBUG: UI PARITY INVESTIGATION FOR PROBLEM WALLETS');
  console.log('='.repeat(100));
  console.log('');
  console.log('Analyzing wallets: W1, W5, W6');
  console.log('');

  for (const label of PROBLEM_WALLETS) {
    const bm = UI_BENCHMARK_WALLETS.find((w) => w.label === label);
    if (!bm) {
      console.log(`Wallet ${label} not found in benchmarks`);
      continue;
    }

    await analyzeWallet(bm);
  }

  // Also analyze W2 for comparison (known to work)
  console.log('');
  console.log('REFERENCE: W2 (known good match)');
  const w2 = UI_BENCHMARK_WALLETS.find((w) => w.label === 'W2')!;
  await analyzeWallet(w2);

  // Summary
  console.log('='.repeat(100));
  console.log('SUMMARY OF FINDINGS');
  console.log('='.repeat(100));
  console.log('');
  console.log('Key patterns to look for:');
  console.log('  1. Volume consistently LOWER → UI may count redemptions as volume');
  console.log('  2. Gain HIGHER → We are auto-realizing unredeemed winners (UI does not)');
  console.log('  3. Loss HIGHER → We are auto-realizing all resolution losses');
  console.log('');
  console.log('Recommended algorithm tweaks based on data above.');
}

main().catch(console.error);
