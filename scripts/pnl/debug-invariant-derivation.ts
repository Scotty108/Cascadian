/**
 * Invariant Derivation from First Principles
 *
 * Let's trace through what happens with each event type:
 *
 * === BUY EVENT ===
 * - Cash OUT: -price × amount (econCashFlow decreases)
 * - Position IN: amount tokens at avgPrice (costBasis increases)
 * - Net effect: econCashFlow = -costBasis (for pure buy-only scenario)
 *
 * === SELL EVENT (without capping) ===
 * - Cash IN: +price × amount (econCashFlow increases)
 * - Position OUT: amount tokens at avgPrice (costBasis decreases)
 * - PnL realized: (price - avgPrice) × amount
 * - Net effect: econCashFlow += sellPrice × amount
 *              costBasis -= avgPrice × amount
 *              realizedPnL += (sellPrice - avgPrice) × amount
 *
 * === DERIVATION ===
 *
 * Let's track the cumulative state:
 *
 * After all buys and sells:
 * - econCashFlow = Σ(sellPrice × sellAmount) - Σ(buyPrice × buyAmount)
 * - costBasis = Σ(avgPrice × remainingPosition)
 * - realizedPnL = Σ((sellPrice - avgPriceAtSale) × soldAmount)
 *
 * For a simple case: buy 10 at $0.60, sell 5 at $0.80, hold 5
 *
 * econCashFlow = (0.80 × 5) - (0.60 × 10) = 4 - 6 = -2
 * costBasis = 0.60 × 5 = 3
 * realizedPnL = (0.80 - 0.60) × 5 = 1
 *
 * Check: econCashFlow = realizedPnL - costBasis?
 *        -2 = 1 - 3 = -2 ✓
 *
 * === THE CORRECT INVARIANT ===
 *
 * econCashFlow = realizedPnL - costBasis
 *
 * Or equivalently:
 * econCashFlow + costBasis = realizedPnL
 *
 * === THE BUG ===
 *
 * The previous invariant was WRONG:
 * econCashFlow = realizedPnL + costBasis  ← WRONG (signs flipped)
 *
 * === WITH CAPPED SELLS ===
 *
 * When we cap sells at tracked position:
 * - User sells 10 tokens but we only tracked 5
 * - We only record PnL for 5 tokens
 * - But econCashFlow captures the full 10 tokens' worth
 *
 * So: econCashFlow + costBasis > realizedPnL (for capped scenarios)
 * The "excess" = capped value = data gap
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

async function derivationTest(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('INVARIANT DERIVATION TEST');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Expected: econCashFlow = realizedPnL - costBasis');
  console.log('Therefore: econCashFlow + costBasis - realizedPnL = 0 (or "capped value" if data gaps)');
  console.log('');

  for (const bm of UI_BENCHMARK_WALLETS) {
    const events = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: false,
    });
    const sortedEvents = sortEventsByTimestamp(events);
    const state = createEmptyEngineState(bm.wallet);

    let econCashFlowRaw = 0n;
    let cappedValue = 0n; // Value of capped sells

    for (const event of sortedEvents) {
      // Before applying, check if this would be capped
      if (event.eventType === 'ORDER_MATCHED_SELL' || event.eventType === 'MERGE' || event.eventType === 'REDEMPTION') {
        const posId = bm.wallet.toLowerCase() + '-' + event.tokenId.toString();
        const pos = state.positions.get(posId);
        const posAmount = pos?.amount ?? 0n;
        if (event.amount > posAmount) {
          const excess = event.amount - posAmount;
          // Value of the capped portion
          if (event.eventType === 'ORDER_MATCHED_SELL') {
            const sellPrice = event.usdcAmountRaw
              ? (event.usdcAmountRaw * COLLATERAL_SCALE) / event.amount
              : event.price;
            cappedValue += (excess * sellPrice) / COLLATERAL_SCALE;
          } else if (event.eventType === 'MERGE') {
            cappedValue += (excess * 500000n) / COLLATERAL_SCALE; // $0.50
          } else if (event.eventType === 'REDEMPTION') {
            const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
            cappedValue += (excess * payoutPrice) / COLLATERAL_SCALE;
          }
        }
      }

      // Compute economic cashflow
      switch (event.eventType) {
        case 'ORDER_MATCHED_BUY':
          econCashFlowRaw -= event.usdcAmountRaw ?? ((event.price * event.amount) / COLLATERAL_SCALE);
          break;
        case 'ORDER_MATCHED_SELL':
          econCashFlowRaw += event.usdcAmountRaw ?? ((event.price * event.amount) / COLLATERAL_SCALE);
          break;
        case 'REDEMPTION':
          const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
          econCashFlowRaw += (payoutPrice * event.amount) / COLLATERAL_SCALE;
          break;
        // SPLIT/MERGE: no cash changes hands (token swap)
      }

      applyEventToState(state, event);
    }

    // Compute cost basis
    let costBasisRaw = 0n;
    for (const pos of state.positions.values()) {
      if (pos.amount > 0n) {
        costBasisRaw += (pos.avgPrice * pos.amount) / COLLATERAL_SCALE;
      }
    }

    const econCashFlow = Number(econCashFlowRaw) / 1e6;
    const costBasis = Number(costBasisRaw) / 1e6;
    const realizedPnl = Number(state.realizedPnlRaw) / 1e6;
    const capped = Number(cappedValue) / 1e6;

    // Invariant: econCashFlow + costBasis - realizedPnL should equal 0 OR capped value
    const invariantDiff = econCashFlow + costBasis - realizedPnl;

    const explain = Math.abs(invariantDiff) < 1.0
      ? '✅ Perfect'
      : Math.abs(capped - invariantDiff) < Math.abs(invariantDiff) * 0.2
        ? '✅ Explained by capped sells'
        : '❌ Unexplained';

    console.log(`${bm.label}:`);
    console.log(`  econCF + costBasis - realPnL = ${econCashFlow.toFixed(2)} + ${costBasis.toFixed(2)} - ${realizedPnl.toFixed(2)} = ${invariantDiff.toFixed(2)}`);
    console.log(`  Capped sell value: $${capped.toFixed(2)}`);
    console.log(`  ${explain}`);
    console.log('');
  }
}

derivationTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
