/**
 * Test ERC1155 Transfer Integration
 *
 * Compares engine results with and without ERC1155 transfers enabled
 * to measure capped sell reduction and impact on PnL.
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  computeWalletPnlFromEvents,
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
  PolymarketPnlEvent,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

interface CappedSellStats {
  cappedEventCount: number;
  cappedTokenCount: number;
  cappedValueUsdc: number;
}

function countCappedSells(
  wallet: string,
  events: PolymarketPnlEvent[]
): CappedSellStats {
  const sortedEvents = sortEventsByTimestamp(events);
  const state = createEmptyEngineState(wallet);
  let cappedEventCount = 0;
  let cappedValueUsdc = 0n;
  const cappedTokens = new Set<string>();

  for (const event of sortedEvents) {
    // Check for capped sell BEFORE applying to state
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
        cappedEventCount++;
        cappedTokens.add(event.tokenId.toString());
        // Estimate value at $0.50 per token (conservative)
        cappedValueUsdc += (excess * 500000n) / COLLATERAL_SCALE;
      }
    }

    applyEventToState(state, event);
  }

  return {
    cappedEventCount,
    cappedTokenCount: cappedTokens.size,
    cappedValueUsdc: Number(cappedValueUsdc) / 1e6,
  };
}

async function testWallet(wallet: string, label: string): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label} (${wallet.substring(0, 12)}...)`);
  console.log('='.repeat(70));

  // Load events WITHOUT transfers
  const eventsNoTransfers = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: true,
    includeErc1155Transfers: false,
  });

  // Load events WITH transfers
  const eventsWithTransfers = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: true,
    includeErc1155Transfers: true,
  });

  // Count transfer events
  const transferInCount = eventsWithTransfers.filter(
    (e) => e.eventType === 'TRANSFER_IN'
  ).length;
  const transferOutCount = eventsWithTransfers.filter(
    (e) => e.eventType === 'TRANSFER_OUT'
  ).length;

  console.log(`\nEvent Counts:`);
  console.log(`  Without transfers: ${eventsNoTransfers.length} events`);
  console.log(`  With transfers:    ${eventsWithTransfers.length} events`);
  console.log(`  TRANSFER_IN:       ${transferInCount}`);
  console.log(`  TRANSFER_OUT:      ${transferOutCount}`);

  // Compute PnL without transfers
  const resultNoTransfers = computeWalletPnlFromEvents(wallet, eventsNoTransfers);
  const cappedNoTransfers = countCappedSells(wallet, eventsNoTransfers);

  // Compute PnL with transfers
  const resultWithTransfers = computeWalletPnlFromEvents(wallet, eventsWithTransfers);
  const cappedWithTransfers = countCappedSells(wallet, eventsWithTransfers);

  console.log(`\nRealized PnL:`);
  console.log(`  Without transfers: $${resultNoTransfers.realizedPnl.toFixed(2)}`);
  console.log(`  With transfers:    $${resultWithTransfers.realizedPnl.toFixed(2)}`);
  console.log(
    `  Difference:        $${(resultWithTransfers.realizedPnl - resultNoTransfers.realizedPnl).toFixed(2)}`
  );

  console.log(`\nCapped Sells (data gaps):`);
  console.log(`  Without transfers: ${cappedNoTransfers.cappedEventCount} events, ${cappedNoTransfers.cappedTokenCount} tokens, ~$${cappedNoTransfers.cappedValueUsdc.toFixed(2)} value`);
  console.log(`  With transfers:    ${cappedWithTransfers.cappedEventCount} events, ${cappedWithTransfers.cappedTokenCount} tokens, ~$${cappedWithTransfers.cappedValueUsdc.toFixed(2)} value`);

  const cappedReduction = cappedNoTransfers.cappedEventCount - cappedWithTransfers.cappedEventCount;
  const cappedPct =
    cappedNoTransfers.cappedEventCount > 0
      ? ((cappedReduction / cappedNoTransfers.cappedEventCount) * 100).toFixed(1)
      : '0.0';
  console.log(`  Reduction:         ${cappedReduction} events (${cappedPct}%)`);

  console.log(`\nPosition Counts:`);
  console.log(`  Without transfers: ${resultNoTransfers.positionCount}`);
  console.log(`  With transfers:    ${resultWithTransfers.positionCount}`);
}

async function main(): Promise<void> {
  console.log('='.repeat(70));
  console.log('ERC1155 TRANSFER INTEGRATION TEST');
  console.log('='.repeat(70));
  console.log('');
  console.log('This test compares the engine with and without ERC1155 transfers');
  console.log('to measure how much the transfer data fills in data gaps.');

  for (const bm of UI_BENCHMARK_WALLETS) {
    await testWallet(bm.wallet, bm.label);
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log('If TRANSFER_IN events are found and capped sells are reduced,');
  console.log('the ERC1155 transfer integration is working correctly.');
  console.log('');
  console.log('The PnL difference represents gains/losses from transferred tokens');
  console.log('that previously had zero cost basis (capped at position amount).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
