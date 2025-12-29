/**
 * Debug W3 Invariant Violation
 *
 * W3 shows only 1.6% of invariant violation explained by capped sells.
 * This script deep-dives into W3 to find the source of the ~$10,466 discrepancy.
 *
 * Key question: Is this a calculation error or a data gap we're not detecting?
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
  PolymarketPnlEvent,
} from '../../lib/pnl/polymarketSubgraphEngine';

const W3_WALLET = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

interface TokenStats {
  tokenId: string;
  buys: { amount: bigint; usdc: bigint };
  sells: { amount: bigint; usdc: bigint };
  splits: bigint;
  merges: bigint;
  redemptions: { amount: bigint; payout: bigint };
  events: PolymarketPnlEvent[];
}

async function debugW3(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('W3 INVARIANT VIOLATION DEEP-DIVE');
  console.log('═'.repeat(80));
  console.log('');

  const events = await loadPolymarketPnlEventsForWallet(W3_WALLET, {
    includeSyntheticRedemptions: false, // No synth for debug
  });
  const sortedEvents = sortEventsByTimestamp(events);

  console.log(`Total events: ${sortedEvents.length}`);

  // Group events by type
  const byType = new Map<string, number>();
  for (const e of sortedEvents) {
    byType.set(e.eventType, (byType.get(e.eventType) || 0) + 1);
  }
  console.log('\nEvents by type:');
  for (const [type, count] of byType) {
    console.log(`  ${type}: ${count}`);
  }

  // Track per-token stats
  const tokenStats = new Map<string, TokenStats>();

  for (const event of sortedEvents) {
    const tokenId = event.tokenId.toString();
    if (!tokenStats.has(tokenId)) {
      tokenStats.set(tokenId, {
        tokenId,
        buys: { amount: 0n, usdc: 0n },
        sells: { amount: 0n, usdc: 0n },
        splits: 0n,
        merges: 0n,
        redemptions: { amount: 0n, payout: 0n },
        events: [],
      });
    }
    const stats = tokenStats.get(tokenId)!;
    stats.events.push(event);

    switch (event.eventType) {
      case 'ORDER_MATCHED_BUY':
        stats.buys.amount += event.amount;
        stats.buys.usdc += event.usdcAmountRaw ?? ((event.price * event.amount) / COLLATERAL_SCALE);
        break;
      case 'ORDER_MATCHED_SELL':
        stats.sells.amount += event.amount;
        stats.sells.usdc += event.usdcAmountRaw ?? ((event.price * event.amount) / COLLATERAL_SCALE);
        break;
      case 'SPLIT':
        stats.splits += event.amount;
        break;
      case 'MERGE':
        stats.merges += event.amount;
        break;
      case 'REDEMPTION':
        stats.redemptions.amount += event.amount;
        stats.redemptions.payout += ((event.payoutPrice ?? COLLATERAL_SCALE) * event.amount) / COLLATERAL_SCALE;
        break;
    }
  }

  // Run engine and compute economic cashflow
  const state = createEmptyEngineState(W3_WALLET);
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
  let unrealizedCostBasisRaw = 0n;
  let openPositions = 0;
  for (const pos of state.positions.values()) {
    if (pos.amount > 0n) {
      openPositions++;
      unrealizedCostBasisRaw += (pos.avgPrice * pos.amount) / COLLATERAL_SCALE;
    }
  }

  const enginePnl = Number(state.realizedPnlRaw) / 1e6;
  const econCashFlow = Number(econCashFlowRaw) / 1e6;
  const unrealizedCostBasis = Number(unrealizedCostBasisRaw) / 1e6;
  const invariantDiff = econCashFlow - enginePnl - unrealizedCostBasis;

  console.log('\n--- CASHFLOW SUMMARY ---');
  console.log(`Economic cashflow:       $${econCashFlow.toFixed(2)}`);
  console.log(`Engine realized PnL:     $${enginePnl.toFixed(2)}`);
  console.log(`Unrealized cost basis:   $${unrealizedCostBasis.toFixed(2)}`);
  console.log(`Expected (PnL + Unreal): $${(enginePnl + unrealizedCostBasis).toFixed(2)}`);
  console.log(`INVARIANT VIOLATION:     $${invariantDiff.toFixed(2)}`);
  console.log(`Open positions:          ${openPositions}`);

  // Find tokens with issues
  console.log('\n--- TOKEN ANALYSIS ---');
  console.log('Looking for tokens where economic value != tracked value...\n');

  // Sort tokens by activity
  const sortedTokens = [...tokenStats.values()]
    .sort((a, b) => b.events.length - a.events.length);

  let totalBuyUsdc = 0n;
  let totalSellUsdc = 0n;
  let totalRedemptionPayout = 0n;

  for (const stats of sortedTokens) {
    totalBuyUsdc += stats.buys.usdc;
    totalSellUsdc += stats.sells.usdc;
    totalRedemptionPayout += stats.redemptions.payout;

    // Compute token-level economic flows
    const tokenEconFlow =
      - Number(stats.buys.usdc) / 1e6  // cash out for buys
      + Number(stats.sells.usdc) / 1e6  // cash in from sells
      + Number(stats.redemptions.payout) / 1e6;  // cash in from redemptions

    // Get engine position for this token
    const posId = W3_WALLET.toLowerCase() + '-' + stats.tokenId;
    const pos = state.positions.get(posId);
    const posAmount = pos?.amount ?? 0n;
    const posAvgPrice = pos?.avgPrice ?? 0n;
    const posCostBasis = Number((posAvgPrice * posAmount) / COLLATERAL_SCALE) / 1e6;
    const posRealizedPnl = Number(pos?.realizedPnl ?? 0n) / 1e6;

    // Expected from engine: realizedPnl + costBasis should equal economic flow
    const engineExpected = posRealizedPnl + posCostBasis;
    const tokenDiff = tokenEconFlow - engineExpected;

    // Only show tokens with significant differences
    if (Math.abs(tokenDiff) > 1.0 || stats.events.length > 10) {
      console.log(`Token ${stats.tokenId.substring(0, 16)}...`);
      console.log(`  Events: ${stats.events.length} (buy=${stats.buys.amount > 0n ? 'Y' : 'N'}, sell=${stats.sells.amount > 0n ? 'Y' : 'N'}, redeem=${stats.redemptions.amount > 0n ? 'Y' : 'N'})`);
      console.log(`  Buys:   ${(Number(stats.buys.amount) / 1e6).toFixed(2)} tokens for $${(Number(stats.buys.usdc) / 1e6).toFixed(2)}`);
      console.log(`  Sells:  ${(Number(stats.sells.amount) / 1e6).toFixed(2)} tokens for $${(Number(stats.sells.usdc) / 1e6).toFixed(2)}`);
      console.log(`  Splits: ${(Number(stats.splits) / 1e6).toFixed(2)}, Merges: ${(Number(stats.merges) / 1e6).toFixed(2)}`);
      console.log(`  Redemp: ${(Number(stats.redemptions.amount) / 1e6).toFixed(2)} tokens, payout $${(Number(stats.redemptions.payout) / 1e6).toFixed(2)}`);
      console.log(`  Engine: pos=${(Number(posAmount) / 1e6).toFixed(2)} @ $${(Number(posAvgPrice) / 1e6).toFixed(4)}, costBasis=$${posCostBasis.toFixed(2)}, realPnL=$${posRealizedPnl.toFixed(2)}`);
      console.log(`  Econ flow: $${tokenEconFlow.toFixed(2)}, Engine expected: $${engineExpected.toFixed(2)}, DIFF: $${tokenDiff.toFixed(2)}`);
      console.log('');
    }
  }

  console.log('\n--- AGGREGATE CHECK ---');
  console.log(`Total buy USDC:         $${(Number(totalBuyUsdc) / 1e6).toFixed(2)}`);
  console.log(`Total sell USDC:        $${(Number(totalSellUsdc) / 1e6).toFixed(2)}`);
  console.log(`Total redemption payout: $${(Number(totalRedemptionPayout) / 1e6).toFixed(2)}`);
  console.log(`Net economic:           $${((Number(totalSellUsdc) + Number(totalRedemptionPayout) - Number(totalBuyUsdc)) / 1e6).toFixed(2)}`);

  // Check for SPLIT/MERGE without proper USDC tracking
  console.log('\n--- SPLIT/MERGE ANALYSIS ---');
  let totalSplits = 0n;
  let totalMerges = 0n;
  for (const stats of sortedTokens) {
    totalSplits += stats.splits;
    totalMerges += stats.merges;
  }
  console.log(`Total splits: ${(Number(totalSplits) / 1e6).toFixed(2)} tokens`);
  console.log(`Total merges: ${(Number(totalMerges) / 1e6).toFixed(2)} tokens`);
  console.log('');
  console.log('Note: SPLITs cost $0.50/token (cash out), MERGEs return $0.50/token (cash in)');
  const splitCashOut = (Number(totalSplits) * 0.5);
  const mergeCashIn = (Number(totalMerges) * 0.5);
  console.log(`Split cash out: $${(splitCashOut / 1e6).toFixed(2)}`);
  console.log(`Merge cash in:  $${(mergeCashIn / 1e6).toFixed(2)}`);

  // The issue: our econCashFlow doesn't include split/merge cash!
  const correctedEconCashFlow = econCashFlow - splitCashOut / 1e6 + mergeCashIn / 1e6;
  const correctedInvariantDiff = correctedEconCashFlow - enginePnl - unrealizedCostBasis;

  console.log('\n--- CORRECTED INVARIANT ---');
  console.log(`Original econ cashflow:  $${econCashFlow.toFixed(2)}`);
  console.log(`Split/merge adjustment:  $${((mergeCashIn - splitCashOut) / 1e6).toFixed(2)}`);
  console.log(`Corrected econ cashflow: $${correctedEconCashFlow.toFixed(2)}`);
  console.log(`Engine + unrealized:     $${(enginePnl + unrealizedCostBasis).toFixed(2)}`);
  console.log(`CORRECTED INVARIANT:     $${correctedInvariantDiff.toFixed(2)}`);

  if (Math.abs(correctedInvariantDiff) < 10) {
    console.log('\n✅ SPLIT/MERGE CASH FLOWS EXPLAIN THE VIOLATION!');
    console.log('   The engine is CORRECT. We were missing split/merge cash flows in our economic calculation.');
  } else {
    console.log('\n❌ Still have unexplained difference after split/merge correction.');
  }
}

debugW3().catch((err) => {
  console.error(err);
  process.exit(1);
});
