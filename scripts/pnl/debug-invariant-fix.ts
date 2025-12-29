/**
 * Debug Invariant Fix - Understanding the Correct Formula
 *
 * The CORRECT accounting identity is:
 *
 *   Total Economic Value = Realized PnL + Unrealized Value
 *
 * Where:
 * - Realized PnL = cash received from sells/redemptions - cash paid for buys (for closed positions)
 * - Unrealized Value = current market value - cost basis (for open positions)
 *
 * But we don't have market prices! So we can't compute unrealized value.
 *
 * What we CAN verify:
 *   econCashFlow = realizedPnL - costBasis
 *
 * Why? Because:
 * - econCashFlow = sellProceeds - buyPayments
 * - For closed positions: sellProceeds - buyPayments = realizedPnL (since costBasis=0)
 * - For open positions: sellProceeds - buyPayments = partialRealizedPnL - remainingCostBasis
 *
 * So the CORRECT invariant is:
 *   econCashFlow = realizedPnL - costBasis
 *
 * Or equivalently:
 *   econCashFlow + costBasis = realizedPnL
 *
 * NOT:
 *   econCashFlow = realizedPnL + costBasis  ← THIS IS WRONG!
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

async function testCorrectInvariant(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('TESTING CORRECT INVARIANT');
  console.log('═'.repeat(80));
  console.log('');
  console.log('CORRECT FORMULA: econCashFlow + costBasis = realizedPnL');
  console.log('');
  console.log('Why? Because:');
  console.log('  econCashFlow = sellProceeds - buyPayments');
  console.log('  For buys: we pay cash (negative) and get costBasis (positive asset)');
  console.log('  For sells: we get cash (positive) and lose costBasis, gain realizedPnL');
  console.log('');
  console.log('─'.repeat(80));

  for (const bm of UI_BENCHMARK_WALLETS) {
    const events = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: false,
    });
    const sortedEvents = sortEventsByTimestamp(events);
    const state = createEmptyEngineState(bm.wallet);

    let econCashFlowRaw = 0n;

    for (const event of sortedEvents) {
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
      }
      applyEventToState(state, event);
    }

    // Compute unrealized cost basis
    let costBasisRaw = 0n;
    for (const pos of state.positions.values()) {
      if (pos.amount > 0n) {
        costBasisRaw += (pos.avgPrice * pos.amount) / COLLATERAL_SCALE;
      }
    }

    const econCashFlow = Number(econCashFlowRaw) / 1e6;
    const costBasis = Number(costBasisRaw) / 1e6;
    const realizedPnl = Number(state.realizedPnlRaw) / 1e6;

    // CORRECT INVARIANT: econCashFlow + costBasis = realizedPnl
    const leftSide = econCashFlow + costBasis;
    const rightSide = realizedPnl;
    const diff = leftSide - rightSide;

    const ok = Math.abs(diff) < 1.0 ? '✅' : '❌';

    console.log(`${bm.label}: econCF=${econCashFlow.toFixed(2).padStart(12)} + costBasis=${costBasis.toFixed(2).padStart(10)} = ${leftSide.toFixed(2).padStart(12)} | realPnL=${rightSide.toFixed(2).padStart(12)} | diff=${diff.toFixed(2).padStart(10)} ${ok}`);
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('INTERPRETATION:');
  console.log('  ✅ = Engine math is CORRECT (invariant holds within $1)');
  console.log('  ❌ = Either engine bug OR capped sells (sells > tracked buys)');
  console.log('');
  console.log('If ❌, the diff shows how much value was sold without tracked cost basis.');
  console.log('This is the "capped sells" phenomenon - users selling tokens received via transfer.');
  console.log('═'.repeat(80));
}

testCorrectInvariant().catch((err) => {
  console.error(err);
  process.exit(1);
});
