/**
 * Debug the synthetic pair issue in detail
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents, createEmptyEngineState, applyEventToState, sortEventsByTimestamp } from '../../lib/pnl/polymarketSubgraphEngine';
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

async function debug() {
  console.log('Debugging wallet:', wallet);

  // Load events
  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false,
  });

  // Get token mappings
  const tokenIds = [...new Set(events.map(e => e.tokenId.toString()))];
  console.log('Unique tokens:', tokenIds.length);

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

  // Group events by type
  const buys = events.filter(e => e.eventType === 'ORDER_MATCHED_BUY');
  const sells = events.filter(e => e.eventType === 'ORDER_MATCHED_SELL');
  const redemptions = events.filter(e => e.eventType === 'REDEMPTION');

  console.log('\nBuys:', buys.length);
  console.log('Sells:', sells.length);
  console.log('Redemptions:', redemptions.length);

  // Check which tokens have buys
  const tokensWithBuys = new Set(buys.map(e => e.tokenId.toString()));
  const tokensWithSells = new Set(sells.map(e => e.tokenId.toString()));
  const tokensWithRedemptions = new Set(redemptions.map(e => e.tokenId.toString()));

  console.log('\nTokens with buys:', tokensWithBuys.size);
  console.log('Tokens with sells:', tokensWithSells.size);
  console.log('Tokens with redemptions:', tokensWithRedemptions.size);

  // Find sells without buys
  const sellsWithoutBuys = sells.filter(s => !tokensWithBuys.has(s.tokenId.toString()));
  console.log('\nSells without prior buys:', sellsWithoutBuys.length);

  // Analyze by condition
  console.log('\n=== Condition-level Analysis ===');

  const conditionActivity = new Map<string, {
    buyTokens: Set<string>;
    sellTokens: Set<string>;
    redemptionTokens: Set<string>;
    buyUsdc: number;
    sellUsdc: number;
  }>();

  for (const e of events) {
    const mapping = tokenToCondition.get(e.tokenId.toString());
    if (!mapping) continue;

    const cid = mapping.conditionId;
    if (!conditionActivity.has(cid)) {
      conditionActivity.set(cid, {
        buyTokens: new Set(),
        sellTokens: new Set(),
        redemptionTokens: new Set(),
        buyUsdc: 0,
        sellUsdc: 0,
      });
    }

    const act = conditionActivity.get(cid)!;
    if (e.eventType === 'ORDER_MATCHED_BUY') {
      act.buyTokens.add(e.tokenId.toString());
      act.buyUsdc += Number(e.usdcAmountRaw || 0) / 1e6;
    } else if (e.eventType === 'ORDER_MATCHED_SELL') {
      act.sellTokens.add(e.tokenId.toString());
      act.sellUsdc += Number(e.usdcAmountRaw || 0) / 1e6;
    } else if (e.eventType === 'REDEMPTION') {
      act.redemptionTokens.add(e.tokenId.toString());
    }
  }

  // Find synthetic split conditions (buy one, sell other)
  let syntheticSplitConditions = 0;
  for (const [cid, act] of conditionActivity.entries()) {
    const buyOnly = [...act.buyTokens].filter(t => !act.sellTokens.has(t));
    const sellOnly = [...act.sellTokens].filter(t => !act.buyTokens.has(t));

    if (buyOnly.length > 0 && sellOnly.length > 0) {
      syntheticSplitConditions++;
      console.log(`\nCondition: ${cid.substring(0, 20)}...`);
      console.log(`  Buy-only tokens: ${buyOnly.length}`);
      console.log(`  Sell-only tokens: ${sellOnly.length} (phantom sells)`);
      console.log(`  Buy USDC: $${act.buyUsdc.toFixed(2)}`);
      console.log(`  Sell USDC: $${act.sellUsdc.toFixed(2)} (received from phantom sells)`);
    }
  }

  console.log(`\nTotal synthetic split conditions: ${syntheticSplitConditions}`);

  // Now trace through the engine step by step
  console.log('\n=== Step-by-step Engine Trace ===');

  const sortedEvents = sortEventsByTimestamp(events);
  const state = createEmptyEngineState(wallet);

  let totalRealizedPnl = 0n;
  for (const event of sortedEvents) {
    const beforePnl = state.realizedPnlRaw;
    applyEventToState(state, event);
    const deltaPnl = state.realizedPnlRaw - beforePnl;

    if (deltaPnl !== 0n) {
      const mapping = tokenToCondition.get(event.tokenId.toString());
      console.log(`${event.eventType} token=${event.tokenId.toString().substring(0, 10)}... cond=${mapping?.conditionId.substring(0, 10) || 'N/A'} deltaPnL=$${(Number(deltaPnl) / 1e6).toFixed(2)}`);
    }
    totalRealizedPnl = state.realizedPnlRaw;
  }

  console.log(`\nFinal realized PnL: $${(Number(totalRealizedPnl) / 1e6).toFixed(2)}`);

  // Check which redemptions had zero-amount positions
  console.log('\n=== Redemptions with zero position ===');
  let zeroPositionRedemptions = 0;
  for (const r of redemptions) {
    const posId = `${wallet.toLowerCase()}-${r.tokenId.toString()}`;
    const pos = state.positions.get(posId);
    // Check if the position had any buys before redemption
    const hadBuys = buys.some(b => b.tokenId === r.tokenId);
    if (!hadBuys) {
      zeroPositionRedemptions++;
      const mapping = tokenToCondition.get(r.tokenId.toString());
      const payoutPrice = Number(r.payoutPrice || 0) / 1e6;
      console.log(`  Token ${r.tokenId.toString().substring(0, 20)}... outcome=${mapping?.outcomeIndex} payout=$${payoutPrice.toFixed(2)}`);
    }
  }
  console.log(`\nRedemptions without prior buys: ${zeroPositionRedemptions}/${redemptions.length}`);
}

debug().catch(console.error);
