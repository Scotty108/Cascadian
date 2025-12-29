/**
 * Test V4: Asymmetric Resolution
 *
 * Hypothesis: UI only auto-realizes LOSSES at resolution, not gains.
 * - If payout_price = 0 (loser) → realize the loss
 * - If payout_price > 0 (winner) → do NOT realize until redemption
 *
 * This test compares V3 (current) vs V4 (asymmetric) for benchmark wallets.
 *
 * Usage: npx tsx scripts/pnl/test-v4-asymmetric-resolution.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  getClobFillsForWallet,
  getRedemptionsForWallet,
  getResolutionsForConditions,
  type ActivityEvent,
  type ResolutionInfo,
} from '../../lib/pnl';
import { UI_BENCHMARK_WALLETS, type UIBenchmarkWallet } from './ui-benchmark-constants';

interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
}

interface V4Result {
  pnl_total: number;
  gain: number;
  loss: number;
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution_losses: number; // Only losers
  skipped_resolution_gains: number; // Winners we didn't realize
}

/**
 * V4 Algorithm: Asymmetric resolution (only realize losses, not gains)
 */
function calculateActivityPnLV4(
  events: ActivityEvent[],
  resolutions: Map<string, ResolutionInfo>
): V4Result {
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  const outcomeStates = new Map<string, OutcomeState>();
  const getKey = (conditionId: string, outcomeIndex: number): string =>
    `${conditionId}_${outcomeIndex}`;

  let pnl_from_clob = 0;
  let pnl_from_redemptions = 0;

  // Process CLOB + redemptions
  for (const event of events) {
    const key = getKey(event.condition_id, event.outcome_index);

    if (!outcomeStates.has(key)) {
      outcomeStates.set(key, { position_qty: 0, position_cost: 0, realized_pnl: 0 });
    }

    const state = outcomeStates.get(key)!;

    if (event.event_type === 'CLOB_BUY') {
      state.position_cost += event.usdc_notional;
      state.position_qty += event.qty_tokens;
    } else if (event.event_type === 'CLOB_SELL') {
      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
        const pnl_now = (event.price - avg_cost) * qty_to_sell;
        state.realized_pnl += pnl_now;
        pnl_from_clob += pnl_now;
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;
      }
    } else if (event.event_type === 'REDEMPTION') {
      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
        const pnl_now = (event.price - avg_cost) * qty_to_sell;
        state.realized_pnl += pnl_now;
        pnl_from_redemptions += pnl_now;
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;
      }
    }
  }

  // V4 CHANGE: Only realize LOSSES at resolution (payout_price = 0)
  let pnl_from_resolution_losses = 0;
  let skipped_resolution_gains = 0;

  for (const [key, state] of outcomeStates.entries()) {
    if (state.position_qty <= 0.01) continue;

    const [conditionId, outcomeIndexStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr, 10);
    const resolution = resolutions.get(conditionId.toLowerCase());

    if (!resolution || !resolution.payout_numerators) continue;

    const payout_price = resolution.payout_numerators[outcomeIndex] || 0;

    if (payout_price === 0) {
      // LOSER: Realize the loss
      const avg_cost = state.position_cost / state.position_qty;
      const pnl_from_resolution = (payout_price - avg_cost) * state.position_qty;
      state.realized_pnl += pnl_from_resolution;
      pnl_from_resolution_losses += pnl_from_resolution;
      state.position_qty = 0;
      state.position_cost = 0;
    } else {
      // WINNER: Skip - don't realize until redemption
      const avg_cost = state.position_cost / state.position_qty;
      const would_be_gain = (payout_price - avg_cost) * state.position_qty;
      skipped_resolution_gains += would_be_gain;
      // Keep position as-is
    }
  }

  // Aggregate
  let pnl_total = 0;
  let gain = 0;
  let loss = 0;

  for (const state of outcomeStates.values()) {
    pnl_total += state.realized_pnl;
    if (state.realized_pnl > 0) gain += state.realized_pnl;
    else loss += state.realized_pnl;
  }

  return {
    pnl_total,
    gain,
    loss,
    pnl_from_clob,
    pnl_from_redemptions,
    pnl_from_resolution_losses,
    skipped_resolution_gains,
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return n.toFixed(1) + '%';
}

function calcErrorPct(computed: number, ui: number): number {
  return (Math.abs(computed - ui) / (Math.abs(ui) + 1e-9)) * 100;
}

async function testWallet(bm: UIBenchmarkWallet): Promise<void> {
  console.log(`\n${bm.label} (${bm.wallet.substring(0, 14)}...):`);

  // Load data
  const clobFills = await getClobFillsForWallet(bm.wallet);
  const redemptions = await getRedemptionsForWallet(bm.wallet);
  const allEvents = [...clobFills, ...redemptions];
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];
  const resolutions = await getResolutionsForConditions(conditionIds);

  // Run V4
  const v4 = calculateActivityPnLV4(allEvents, resolutions);

  const v4_err = calcErrorPct(v4.pnl_total, bm.profitLoss_all);

  console.log(`  UI PnL:         $${formatNumber(bm.profitLoss_all)}`);
  console.log(`  V4 PnL:         $${formatNumber(v4.pnl_total)} (err: ${formatPct(v4_err)})`);
  console.log(`  V4 skipped:     $${formatNumber(v4.skipped_resolution_gains)} (unrealized gains)`);
  console.log(`  V4 decomp:      CLOB=$${formatNumber(v4.pnl_from_clob)}, redemp=$${formatNumber(v4.pnl_from_redemptions)}, resLoss=$${formatNumber(v4.pnl_from_resolution_losses)}`);
}

async function main(): Promise<void> {
  console.log('='.repeat(100));
  console.log('TEST V4: ASYMMETRIC RESOLUTION (only auto-realize losses, not gains)');
  console.log('='.repeat(100));

  for (const bm of UI_BENCHMARK_WALLETS) {
    await testWallet(bm);
  }

  console.log('\n');
  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log('');
  console.log('If V4 errors are lower than V3, the asymmetric resolution hypothesis is correct.');
  console.log('V3 baseline errors: W1=21%, W2=0%, W3=outlier, W4=21%, W5=129%, W6=26%');
}

main().catch(console.error);
