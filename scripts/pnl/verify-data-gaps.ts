/**
 * Verify Data Gaps vs Calculation Errors
 *
 * This script rigorously analyzes whether PnL discrepancies are due to:
 * 1. Actual data gaps (missing buy events for tokens that were sold)
 * 2. Calculation errors in our engine
 *
 * For each wallet, we:
 * 1. Track all buy/sell/split/merge events per token
 * 2. Identify "capped sells" where we sold more than we bought
 * 3. Verify the capped amount matches the invariant violation
 *
 * If capped_sells_value ≈ invariant_violation, it's a data gap.
 * If they don't match, there's a calculation error.
 */

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import {
  createEmptyEngineState,
  applyEventToState,
  sortEventsByTimestamp,
  COLLATERAL_SCALE,
} from '../../lib/pnl/polymarketSubgraphEngine';
import { UI_BENCHMARK_WALLETS } from './ui-benchmark-constants';

interface TokenAnalysis {
  tokenId: string;
  buys: bigint;
  sells: bigint;
  splits: bigint;
  merges: bigint;
  redemptions: bigint;
  cappedAmount: bigint;
  avgPriceAtCap: bigint;
}

async function analyzeWallet(wallet: string, label: string): Promise<void> {
  const events = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
  });
  const sortedEvents = sortEventsByTimestamp(events);
  const state = createEmptyEngineState(wallet);

  // Track stats by token
  const tokenAnalysis = new Map<string, TokenAnalysis>();

  // Track economic cashflow
  let econCashFlowRaw = 0n;

  for (const event of sortedEvents) {
    const tokenId = event.tokenId.toString();

    // Initialize token analysis if needed
    if (!tokenAnalysis.has(tokenId)) {
      tokenAnalysis.set(tokenId, {
        tokenId,
        buys: 0n,
        sells: 0n,
        splits: 0n,
        merges: 0n,
        redemptions: 0n,
        cappedAmount: 0n,
        avgPriceAtCap: 0n,
      });
    }
    const analysis = tokenAnalysis.get(tokenId)!;

    // Track event by type
    switch (event.eventType) {
      case 'ORDER_MATCHED_BUY':
        analysis.buys += event.amount;
        econCashFlowRaw -= event.usdcAmountRaw ?? (event.price * event.amount) / COLLATERAL_SCALE;
        break;
      case 'ORDER_MATCHED_SELL':
        analysis.sells += event.amount;
        econCashFlowRaw += event.usdcAmountRaw ?? (event.price * event.amount) / COLLATERAL_SCALE;
        break;
      case 'SPLIT':
        analysis.splits += event.amount;
        break;
      case 'MERGE':
        analysis.merges += event.amount;
        break;
      case 'REDEMPTION':
        analysis.redemptions += event.amount;
        const payoutPrice = event.payoutPrice ?? COLLATERAL_SCALE;
        econCashFlowRaw += (payoutPrice * event.amount) / COLLATERAL_SCALE;
        break;
    }

    // Check for capped sell BEFORE applying to state
    if (
      event.eventType === 'ORDER_MATCHED_SELL' ||
      event.eventType === 'MERGE' ||
      event.eventType === 'REDEMPTION'
    ) {
      const posId = wallet.toLowerCase() + '-' + tokenId;
      const pos = state.positions.get(posId);
      const posAmount = pos?.amount ?? 0n;

      if (event.amount > posAmount) {
        const excess = event.amount - posAmount;
        analysis.cappedAmount += excess;
        // Record the avgPrice when capping occurred (for value estimation)
        if (pos && pos.avgPrice > 0n) {
          analysis.avgPriceAtCap = pos.avgPrice;
        }
      }
    }

    applyEventToState(state, event);
  }

  // Calculate totals
  let totalCappedAmount = 0n;
  let totalCappedValue = 0n; // Estimated value of capped tokens
  let tokensWithCaps = 0;

  for (const analysis of tokenAnalysis.values()) {
    if (analysis.cappedAmount > 0n) {
      tokensWithCaps++;
      totalCappedAmount += analysis.cappedAmount;
      // Estimate value: use avgPrice if available, else assume $0.50
      const avgPrice = analysis.avgPriceAtCap > 0n ? analysis.avgPriceAtCap : 500000n;
      totalCappedValue += (analysis.cappedAmount * avgPrice) / COLLATERAL_SCALE;
    }
  }

  // Calculate unrealized cost basis
  let unrealizedCostBasis = 0n;
  for (const pos of state.positions.values()) {
    if (pos.amount > 0n) {
      unrealizedCostBasis += (pos.avgPrice * pos.amount) / COLLATERAL_SCALE;
    }
  }

  // The invariant: econCashFlow == enginePnL + unrealizedCostBasis
  const enginePnl = state.realizedPnlRaw;
  const invariantDiff = econCashFlowRaw - enginePnl - unrealizedCostBasis;

  // Report
  console.log('\n' + '='.repeat(80));
  console.log(`${label} - DATA GAP VERIFICATION`);
  console.log('='.repeat(80));

  console.log('\n--- CASHFLOW ANALYSIS ---');
  console.log(`Economic cashflow:     $${(Number(econCashFlowRaw) / 1e6).toFixed(2)}`);
  console.log(`Engine realized PnL:   $${(Number(enginePnl) / 1e6).toFixed(2)}`);
  console.log(`Unrealized cost basis: $${(Number(unrealizedCostBasis) / 1e6).toFixed(2)}`);
  console.log(`Expected (PnL + Unrealized): $${(Number(enginePnl + unrealizedCostBasis) / 1e6).toFixed(2)}`);
  console.log(`Invariant violation:   $${(Number(invariantDiff) / 1e6).toFixed(2)}`);

  console.log('\n--- CAPPED SELLS (MISSING DATA) ---');
  console.log(`Tokens with caps:      ${tokensWithCaps}`);
  console.log(`Total capped tokens:   ${(Number(totalCappedAmount) / 1e6).toFixed(2)}`);
  console.log(`Est. capped value:     $${(Number(totalCappedValue) / 1e6).toFixed(2)}`);

  // The key verification: does capped value explain the invariant violation?
  console.log('\n--- VERIFICATION ---');
  const explanation = Math.abs(Number(totalCappedValue) - Math.abs(Number(invariantDiff)));
  const explanationPct = Math.abs(Number(invariantDiff)) > 0
    ? (Number(totalCappedValue) / Math.abs(Number(invariantDiff))) * 100
    : 0;

  if (tokensWithCaps === 0 && Math.abs(Number(invariantDiff)) < 1_000_000) {
    console.log('✅ No data gaps, invariant holds within $1');
  } else if (explanationPct > 80 && explanationPct < 120) {
    console.log(`✅ Capped sells explain ${explanationPct.toFixed(1)}% of invariant violation`);
    console.log('   This is a DATA GAP, not a calculation error.');
  } else if (explanationPct > 50) {
    console.log(`⚠️ Capped sells explain ${explanationPct.toFixed(1)}% of invariant violation`);
    console.log('   Likely a DATA GAP with some rounding or timing differences.');
  } else {
    console.log(`❌ Capped sells only explain ${explanationPct.toFixed(1)}% of invariant violation`);
    console.log('   Gap: $' + (explanation / 1e6).toFixed(2) + ' unexplained');
    console.log('   POTENTIAL CALCULATION ERROR - needs investigation');
  }

  // Show top capped tokens
  if (tokensWithCaps > 0) {
    console.log('\n--- TOP CAPPED TOKENS ---');
    const sortedTokens = [...tokenAnalysis.values()]
      .filter((a) => a.cappedAmount > 0n)
      .sort((a, b) => (Number(b.cappedAmount) - Number(a.cappedAmount)));

    for (const t of sortedTokens.slice(0, 5)) {
      const net = t.buys + t.splits - t.sells - t.merges - t.redemptions;
      console.log(`Token ${t.tokenId.substring(0, 12)}...:`);
      console.log(`  Buys: ${(Number(t.buys) / 1e6).toFixed(2)}, Sells: ${(Number(t.sells) / 1e6).toFixed(2)}`);
      console.log(`  Splits: ${(Number(t.splits) / 1e6).toFixed(2)}, Merges: ${(Number(t.merges) / 1e6).toFixed(2)}`);
      console.log(`  Redemptions: ${(Number(t.redemptions) / 1e6).toFixed(2)}`);
      console.log(`  Net tracked: ${(Number(net) / 1e6).toFixed(2)}, Capped: ${(Number(t.cappedAmount) / 1e6).toFixed(2)}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('DATA GAP VS CALCULATION ERROR VERIFICATION');
  console.log('='.repeat(80));
  console.log('\nThis verifies whether discrepancies are data gaps or calculation errors.');
  console.log('Key metric: Do capped sells (sells > tracked buys) explain the invariant violation?');

  for (const bm of UI_BENCHMARK_WALLETS) {
    await analyzeWallet(bm.wallet, bm.label);
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('\nIf capped sells explain >80% of invariant violations, the engine is correct');
  console.log('and discrepancies are due to missing buy events (transfers, data gaps).');
  console.log('\nIf capped sells explain <50%, there may be calculation errors to investigate.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
