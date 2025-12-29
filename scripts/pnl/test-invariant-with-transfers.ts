/**
 * Invariant Validation WITH ERC1155 Transfers
 *
 * This tests the invariant:
 * econCashFlow + costBasis + transferOutCostBasis - realizedPnL = cappedSellValue
 *
 * Key insight:
 * - TRANSFER_OUT removes tokens WITHOUT realizing PnL
 * - Those tokens had cost basis (avgPrice × amount) that "leaks" out
 * - We must track this leakage to balance the invariant
 *
 * With transfers enabled, we should see:
 * 1. TRANSFER_IN events don't affect econCashFlow (no cash moves)
 * 2. TRANSFER_IN tokens have zero cost basis (avgPrice dilutes)
 * 3. TRANSFER_OUT removes cost basis without PnL realization
 * 4. The invariant should still hold when accounting for leaked cost basis
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
  PolymarketPnlEvent,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

interface InvariantResult {
  econCashFlow: number;
  costBasis: number;
  realizedPnl: number;
  cappedValue: number;
  transferOutCostBasis: number;
  invariantDiff: number;
  explained: boolean;
}

function runInvariantCheck(
  wallet: string,
  events: PolymarketPnlEvent[]
): InvariantResult {
  const sortedEvents = sortEventsByTimestamp(events);
  const state = createEmptyEngineState(wallet);

  let econCashFlowRaw = 0n;
  let cappedValue = 0n;
  let transferOutCostBasisRaw = 0n;

  for (const event of sortedEvents) {
    // Before applying, check if this would be capped
    if (
      event.eventType === 'ORDER_MATCHED_SELL' ||
      event.eventType === 'MERGE' ||
      event.eventType === 'REDEMPTION'
    ) {
      const posId = wallet.toLowerCase() + '-' + event.tokenId.toString();
      const pos = state.positions.get(posId);
      const posAmount = pos?.amount ?? 0n;
      if (event.amount > posAmount) {
        const excess = event.amount - posAmount;
        if (event.eventType === 'ORDER_MATCHED_SELL') {
          const sellPrice = event.usdcAmountRaw
            ? (event.usdcAmountRaw * COLLATERAL_SCALE) / event.amount
            : event.price;
          cappedValue += (excess * sellPrice) / COLLATERAL_SCALE;
        } else if (event.eventType === 'MERGE') {
          cappedValue += (excess * 500000n) / COLLATERAL_SCALE;
        } else if (event.eventType === 'REDEMPTION') {
          const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
          cappedValue += (excess * payoutPrice) / COLLATERAL_SCALE;
        }
      }
    }

    // Track TRANSFER_OUT cost basis leakage BEFORE applying the event
    // (so we can read the current avgPrice before it's potentially changed)
    if (event.eventType === 'TRANSFER_OUT') {
      const posId = wallet.toLowerCase() + '-' + event.tokenId.toString();
      const pos = state.positions.get(posId);
      if (pos && pos.amount > 0n) {
        // Cost basis being transferred out = avgPrice × min(transferAmount, positionAmount)
        const adjustedAmount =
          event.amount > pos.amount ? pos.amount : event.amount;
        transferOutCostBasisRaw += (pos.avgPrice * adjustedAmount) / COLLATERAL_SCALE;
      }
    }

    // Compute economic cashflow
    // TRANSFER_IN and TRANSFER_OUT do NOT affect econCashFlow (no USDC moves)
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
      // TRANSFER_IN/TRANSFER_OUT: no cash changes hands (just token movement)
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
  const transferOutCostBasis = Number(transferOutCostBasisRaw) / 1e6;

  // Updated invariant: include cost basis that "leaked" via TRANSFER_OUT
  const invariantDiff = econCashFlow + costBasis + transferOutCostBasis - realizedPnl;

  const explained =
    Math.abs(invariantDiff) < 1.0 ||
    Math.abs(capped - invariantDiff) < Math.abs(invariantDiff) * 0.2;

  return {
    econCashFlow,
    costBasis,
    realizedPnl,
    cappedValue: capped,
    transferOutCostBasis,
    invariantDiff,
    explained,
  };
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('INVARIANT VALIDATION: WITH vs WITHOUT ERC1155 TRANSFERS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Invariant: econCashFlow + costBasis + xferOutCB - realizedPnL = cappedSellValue');
  console.log('');

  console.log('─'.repeat(100));
  console.log('| Wallet | Mode         | InvDiff   | Capped    | XferOutCB | Match  |');
  console.log('─'.repeat(100));

  for (const bm of UI_BENCHMARK_WALLETS) {
    // Without transfers
    const eventsNo = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: false,
      includeErc1155Transfers: false,
    });
    const resultNo = runInvariantCheck(bm.wallet, eventsNo);

    // With transfers
    const eventsWith = await loadPolymarketPnlEventsForWallet(bm.wallet, {
      includeSyntheticRedemptions: false,
      includeErc1155Transfers: true,
    });
    const resultWith = runInvariantCheck(bm.wallet, eventsWith);

    const formatResult = (r: InvariantResult) =>
      `${r.invariantDiff.toFixed(2).padStart(9)} | ${r.cappedValue.toFixed(2).padStart(9)} | ${r.transferOutCostBasis.toFixed(2).padStart(9)} | ${r.explained ? '✅' : '❌'}     `;

    console.log(`| ${bm.label.padEnd(6)} | No transfers | ${formatResult(resultNo)} |`);
    console.log(`| ${bm.label.padEnd(6)} | With xfers   | ${formatResult(resultWith)} |`);
    console.log('─'.repeat(100));
  }

  console.log('');
  console.log('ANALYSIS:');
  console.log('- InvDiff = econCashFlow + costBasis + xferOutCB - realizedPnL');
  console.log('- If InvDiff ≈ Capped, the invariant holds (capping explains the gap)');
  console.log('- XferOutCB tracks cost basis that "leaked" out via TRANSFER_OUT events');
  console.log('- TRANSFER_IN tokens have zero cost basis (avgPrice dilutes)');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
