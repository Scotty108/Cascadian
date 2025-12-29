/**
 * Compare UI Trade Stats
 *
 * Compares trade/prediction counts from Polymarket UI with our computed stats.
 *
 * Note: The UI shows "predictions" (number of unique markets/conditions traded)
 * but does NOT show explicit trades_all, wins_all, or losses_all counts.
 *
 * This script compares:
 * - UI predictions vs our outcomes_traded / conditions_traded
 * - Derives win/loss market counts from our resolution data
 *
 * Usage: npx tsx scripts/pnl/compare-ui-trade-stats.ts
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl';
import { UI_BENCHMARK_WALLETS, type UIBenchmarkWallet } from './ui-benchmark-constants';

interface TradeStatsComparison {
  label: string;
  wallet: string;
  // UI values
  ui_predictions: number | undefined;
  // Our computed values
  our_conditions_traded: number;
  our_outcomes_traded: number;
  our_fills_count: number;
  our_redemptions_count: number;
  // Derived from resolution data
  our_winning_outcomes: number;
  our_losing_outcomes: number;
  // Comparison
  prediction_match_pct: number | null;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatPct(n: number | null): string {
  if (n === null) return 'N/A';
  return n.toFixed(1) + '%';
}

async function analyzeWallet(bm: UIBenchmarkWallet): Promise<TradeStatsComparison> {
  const m = await computeWalletActivityPnlV3Debug(bm.wallet);

  // Calculate conditions traded (unique condition_ids)
  // This is what UI calls "predictions"
  const conditions_traded = m.outcomes_traded; // Actually conditions, naming is confusing in current impl

  // Calculate prediction match percentage
  let prediction_match_pct: number | null = null;
  if (bm.predictions !== undefined && bm.predictions > 0) {
    prediction_match_pct = (conditions_traded / bm.predictions) * 100;
  }

  return {
    label: bm.label,
    wallet: bm.wallet,
    ui_predictions: bm.predictions,
    our_conditions_traded: conditions_traded,
    our_outcomes_traded: m.outcomes_traded,
    our_fills_count: m.fills_count,
    our_redemptions_count: m.redemptions_count,
    our_winning_outcomes: m.conditions_with_unredeemed_winners,
    our_losing_outcomes: m.conditions_with_unredeemed_losers,
    prediction_match_pct,
  };
}

async function main(): Promise<void> {
  console.log('='.repeat(100));
  console.log('COMPARE UI TRADE STATS vs OUR COMPUTED STATS');
  console.log('='.repeat(100));
  console.log('');
  console.log('Note: UI "predictions" = unique markets/conditions traded');
  console.log('      Our "outcomes_traded" = unique outcome positions');
  console.log('');

  const results: TradeStatsComparison[] = [];

  for (const bm of UI_BENCHMARK_WALLETS) {
    console.log(`Processing ${bm.label}...`);
    const result = await analyzeWallet(bm);
    results.push(result);
  }

  // Print summary table
  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(100));
  console.log('');

  // Header
  console.log(
    'Label | UI Predictions | Our Outcomes | Fills | Redemptions | Match %'
  );
  console.log('-'.repeat(80));

  for (const r of results) {
    const uiPred = r.ui_predictions !== undefined ? formatNumber(r.ui_predictions) : 'N/A';
    console.log(
      `${r.label.padEnd(5)} | ${uiPred.padStart(14)} | ${formatNumber(r.our_outcomes_traded).padStart(12)} | ${formatNumber(r.our_fills_count).padStart(5)} | ${formatNumber(r.our_redemptions_count).padStart(11)} | ${formatPct(r.prediction_match_pct).padStart(7)}`
    );
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('DETAILED BREAKDOWN');
  console.log('='.repeat(100));

  for (const r of results) {
    console.log('');
    console.log(`${r.label} (${r.wallet.substring(0, 14)}...):`);
    console.log(`  UI Predictions:       ${r.ui_predictions ?? 'N/A'}`);
    console.log(`  Our Outcomes Traded:  ${r.our_outcomes_traded}`);
    console.log(`  Our Fills (CLOB):     ${r.our_fills_count}`);
    console.log(`  Our Redemptions:      ${r.our_redemptions_count}`);
    console.log(`  Unredeemed Winners:   ${r.our_winning_outcomes}`);
    console.log(`  Unredeemed Losers:    ${r.our_losing_outcomes}`);

    if (r.ui_predictions !== undefined) {
      const diff = r.our_outcomes_traded - r.ui_predictions;
      if (Math.abs(diff) <= 2) {
        console.log(`  Status: CLOSE MATCH (diff: ${diff})`);
      } else if (r.our_outcomes_traded > r.ui_predictions) {
        console.log(`  Status: We count MORE (diff: +${diff})`);
        console.log(`    Hypothesis: We count per-outcome, UI counts per-condition`);
      } else {
        console.log(`  Status: We count FEWER (diff: ${diff})`);
        console.log(`    Hypothesis: We may be missing some trade sources (AMM?)`);
      }
    }
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('ANALYSIS');
  console.log('='.repeat(100));
  console.log('');
  console.log('Key observations:');
  console.log('');
  console.log('1. UI "predictions" likely counts unique CONDITION_IDs (markets), not outcomes');
  console.log('   - A binary market has 1 condition but 2 outcomes');
  console.log('   - Our outcomes_traded may be ~2x UI predictions for binary markets');
  console.log('');
  console.log('2. Trade counts are not directly comparable:');
  console.log('   - UI does not show explicit trade counts');
  console.log('   - Our fills_count = deduplicated CLOB events');
  console.log('   - Redemptions are separate from trades');
  console.log('');
  console.log('3. Win/Loss counts would require:');
  console.log('   - Joining with resolution data');
  console.log('   - Determining which outcomes were profitable');
  console.log('   - UI may count differently (by market vs by position)');
}

main().catch(console.error);
