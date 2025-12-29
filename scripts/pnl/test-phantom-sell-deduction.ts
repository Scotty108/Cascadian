/**
 * Test: Deduct phantom sell proceeds from realized PnL
 *
 * Hypothesis: PolymarketAnalytics calculates PnL = (redemptions - buys) only,
 * excluding sell proceeds. For wallets using "buy one, sell other" pattern,
 * the phantom sell proceeds should be deducted from the engine's PnL.
 *
 * Wallet 0xdbaed59f:
 * - V11: $16,004.50
 * - Cash flow: $13,088 (buys - sells - redemptions)
 * - PolymarketAnalytics: $5,454
 * - Phantom sell proceeds: $7,648
 *
 * If we deduct phantom sells: $13,088 - $7,648 = $5,440 ≈ $5,454 ✓
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

async function test() {
  console.log('Testing phantom sell deduction approach');
  console.log('Wallet:', wallet);
  console.log('Expected PnL: ~$5,454 (from PolymarketAnalytics.com)\n');

  // Load events
  console.log('Loading events...');
  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false,
  });

  // Get token mappings for condition grouping
  const tokenIds = [...new Set(events.map(e => e.tokenId.toString()))];

  const mappingQuery = `
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec IN ({tokenIds:Array(String)})
  `;

  const mappingResult = await clickhouse.query({
    query: mappingQuery,
    query_params: { tokenIds },
    format: 'JSONEachRow',
  });

  const mappings = (await mappingResult.json()) as Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }>;

  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, {
      conditionId: m.condition_id,
      outcomeIndex: m.outcome_index,
    });
  }

  // Calculate V11 baseline
  const v11Result = computeWalletPnlFromEvents(wallet, events);
  console.log('V11 baseline: $' + v11Result.realizedPnl.toFixed(2));

  // Find phantom sells: sells without prior buys in the same token
  const buys = events.filter(e => e.eventType === 'ORDER_MATCHED_BUY');
  const sells = events.filter(e => e.eventType === 'ORDER_MATCHED_SELL');

  const tokensWithBuys = new Set(buys.map(e => e.tokenId.toString()));

  // Calculate phantom sell proceeds
  let phantomSellProceeds = 0;
  const phantomSells = sells.filter(s => !tokensWithBuys.has(s.tokenId.toString()));

  for (const sell of phantomSells) {
    phantomSellProceeds += Number(sell.usdcAmountRaw || 0) / 1e6;
  }

  console.log('\nPhantom sells found:', phantomSells.length);
  console.log('Phantom sell proceeds: $' + phantomSellProceeds.toFixed(2));

  // Calculate adjusted PnL
  const adjustedPnl = v11Result.realizedPnl - phantomSellProceeds;

  console.log('\n=== RESULTS ===');
  console.log('V11 baseline:     $' + v11Result.realizedPnl.toFixed(2));
  console.log('Phantom deduction: -$' + phantomSellProceeds.toFixed(2));
  console.log('Adjusted PnL:     $' + adjustedPnl.toFixed(2));
  console.log('Expected (PA):    $5,454');

  const error = adjustedPnl - 5454;
  const errorPct = (error / 5454) * 100;
  console.log('\nError: $' + error.toFixed(2) + ' (' + errorPct.toFixed(1) + '%)');

  if (Math.abs(errorPct) < 5) {
    console.log('\n✅ Approach works! Within 5% of expected.');
  } else {
    console.log('\n❌ Approach needs refinement. Error exceeds 5%.');
  }

  // Also try: pure cash flow (excluding phantom sells)
  const totalBuyUsdc = buys.reduce((sum, e) => sum + Number(e.usdcAmountRaw || 0), 0) / 1e6;
  const redemptions = events.filter(e => e.eventType === 'REDEMPTION');

  // For redemptions, calculate payout
  let totalRedemptionUsdc = 0;
  for (const r of redemptions) {
    const payoutPrice = Number(r.payoutPrice || 0) / 1e6;
    const amount = Number(r.amount) / 1e6;
    totalRedemptionUsdc += amount * payoutPrice;
  }

  // PolymarketAnalytics formula: redemptions - buys (ignoring sells entirely)
  const paStylePnl = totalRedemptionUsdc - totalBuyUsdc;

  console.log('\n=== PolymarketAnalytics Style ===');
  console.log('Total buys: $' + totalBuyUsdc.toFixed(2));
  console.log('Total redemptions: $' + totalRedemptionUsdc.toFixed(2));
  console.log('PA-style PnL (redemptions - buys): $' + paStylePnl.toFixed(2));

  const paError = paStylePnl - 5454;
  const paErrorPct = (paError / 5454) * 100;
  console.log('PA-style error: $' + paError.toFixed(2) + ' (' + paErrorPct.toFixed(1) + '%)');
}

test().catch(console.error);
