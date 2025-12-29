/**
 * Test the synthetic CLOB pair fix on the problem wallet
 *
 * Expected values from PolymarketAnalytics.com:
 * - Total PnL: $5,454
 * - Total Gains: +$16,005
 * - Total Losses: -$10,550
 *
 * V11 before fix: $16,004.50 (only counting gains, missing losses)
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { normalizeSyntheticClobPairs } from '../../lib/pnl/normalizeSyntheticClobPairs';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

async function test() {
  console.log('Testing synthetic CLOB pair fix');
  console.log('Wallet:', wallet);
  console.log('Expected PnL: ~$5,454 (from PolymarketAnalytics.com)\n');

  // Load events
  console.log('Loading events...');
  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false,
  });

  console.log('Total events loaded:', events.length);

  // Count by type
  const byType: Record<string, number> = {};
  for (const e of events) {
    byType[e.eventType] = (byType[e.eventType] || 0) + 1;
  }
  console.log('Event counts:', byType);

  // Calculate V11 BEFORE fix
  console.log('\n=== V11 BEFORE synthetic pair normalization ===');
  const beforeResult = computeWalletPnlFromEvents(wallet, events);
  console.log('Realized PnL: $' + beforeResult.realizedPnl.toFixed(2));

  // Apply the synthetic pair normalization
  console.log('\n=== Applying synthetic pair normalization ===');
  const { events: normalizedEvents, stats } = await normalizeSyntheticClobPairs(events);

  console.log('Stats:');
  console.log('  Total transactions:', stats.totalTransactions);
  console.log('  Transactions with pairs:', stats.transactionsWithPairs);
  console.log('  Synthetic events created:', stats.syntheticEventsCreated);
  console.log('  Total USDC adjusted: $' + (Number(stats.totalUsdcAdjusted) / 1e6).toFixed(2));

  // Calculate V11 AFTER fix
  console.log('\n=== V11 AFTER synthetic pair normalization ===');
  const afterResult = computeWalletPnlFromEvents(wallet, normalizedEvents);
  console.log('Realized PnL: $' + afterResult.realizedPnl.toFixed(2));

  // Compare to expected
  const expected = 5454;
  const error = afterResult.realizedPnl - expected;
  const errorPct = (error / expected) * 100;

  console.log('\n=== COMPARISON ===');
  console.log('Expected (PolymarketAnalytics): $' + expected.toFixed(2));
  console.log('V11 before fix: $' + beforeResult.realizedPnl.toFixed(2));
  console.log('V11 after fix: $' + afterResult.realizedPnl.toFixed(2));
  console.log('Error: $' + error.toFixed(2) + ' (' + errorPct.toFixed(1) + '%)');

  if (Math.abs(errorPct) < 5) {
    console.log('\n✅ FIX SUCCESSFUL! Within 5% of expected.');
  } else {
    console.log('\n❌ FIX NEEDS WORK. Error exceeds 5%.');
  }
}

test().catch(console.error);
