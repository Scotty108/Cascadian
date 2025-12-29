/**
 * Validate the Cash Flow PnL Engine against known benchmarks
 *
 * Tests:
 * 1. Problem wallet 0xdbaed59f (PA: $5,454, V11: $16,004)
 * 2. Compares V11, Cash Flow, and expected values
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { computeCashFlowPnl, computeDetailedCashFlow } from '../../lib/pnl/cashFlowPnlEngine';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';
const expectedPnl = process.argv[3] ? parseFloat(process.argv[3]) : 5454;

async function validate() {
  console.log('=== Cash Flow PnL Engine Validation ===');
  console.log('Wallet:', wallet);
  console.log('Expected PnL: $' + expectedPnl.toFixed(2));
  console.log('');

  // Load events
  console.log('Loading events...');
  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false,
  });
  console.log('Total events:', events.length);

  // V11 Position-based
  console.log('\n--- V11 Position-Based Engine ---');
  const v11Result = computeWalletPnlFromEvents(wallet, events);
  console.log('Realized PnL: $' + v11Result.realizedPnl.toFixed(2));
  console.log('Event counts:', JSON.stringify(v11Result.eventCounts));

  // V12 Cash Flow
  console.log('\n--- V12 Cash Flow Engine ---');
  const cfResult = computeCashFlowPnl(wallet, events);
  console.log('Realized PnL: $' + cfResult.realizedPnl.toFixed(2));
  console.log('Total buys: $' + cfResult.totalBuyUsdc.toFixed(2));
  console.log('Total redemptions: $' + cfResult.totalRedemptionUsdc.toFixed(2));
  console.log('Total sells: $' + cfResult.totalSellUsdc.toFixed(2) + ' (not in PnL)');
  console.log('Event counts:', JSON.stringify(cfResult.eventCounts));

  // Detailed breakdown
  console.log('\n--- Detailed Cash Flow ---');
  const detailed = computeDetailedCashFlow(wallet, events);
  console.log('Buy cash: $' + detailed.buyCash.toFixed(2));
  console.log('Sell cash: $' + detailed.sellCash.toFixed(2));
  console.log('Redemption cash: $' + detailed.redemptionCash.toFixed(2));
  console.log('Split cost: $' + detailed.splitCost.toFixed(2));
  console.log('Merge return: $' + detailed.mergeReturn.toFixed(2));
  console.log('Net cash flow: $' + detailed.netCashFlow.toFixed(2));
  console.log('Simple PnL (redemptions - buys): $' + detailed.simplePnl.toFixed(2));

  // Comparison
  console.log('\n=== COMPARISON ===');
  console.log('Expected (PA):    $' + expectedPnl.toFixed(2));
  console.log('V11 (position):   $' + v11Result.realizedPnl.toFixed(2));
  console.log('V12 (cash flow):  $' + cfResult.realizedPnl.toFixed(2));

  const v11Error = v11Result.realizedPnl - expectedPnl;
  const v11ErrorPct = (v11Error / expectedPnl) * 100;
  const cfError = cfResult.realizedPnl - expectedPnl;
  const cfErrorPct = (cfError / expectedPnl) * 100;

  console.log('');
  console.log('V11 error: $' + v11Error.toFixed(2) + ' (' + v11ErrorPct.toFixed(1) + '%)');
  console.log('V12 error: $' + cfError.toFixed(2) + ' (' + cfErrorPct.toFixed(1) + '%)');

  if (Math.abs(cfErrorPct) < 5) {
    console.log('\n✅ V12 Cash Flow engine PASSES (within 5% of expected)');
  } else {
    console.log('\n❌ V12 Cash Flow engine FAILS (error exceeds 5%)');
  }

  // Summary of which is better
  console.log('\n=== VERDICT ===');
  if (Math.abs(cfError) < Math.abs(v11Error)) {
    const improvement = Math.abs(v11Error) - Math.abs(cfError);
    console.log('V12 is better by $' + improvement.toFixed(2));
  } else {
    const worse = Math.abs(cfError) - Math.abs(v11Error);
    console.log('V11 is better by $' + worse.toFixed(2));
  }
}

validate().catch(console.error);
