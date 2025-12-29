/**
 * Debug: Find where the $10,550 in losses should be coming from
 */
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { createEmptyEngineState, applyEventToState, sortEventsByTimestamp, PolymarketPnlEvent } from '../../lib/pnl/polymarketSubgraphEngine';
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

async function debug() {
  console.log('Debugging missing losses for wallet:', wallet);

  // Load events
  const { events } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false,
  });

  // Get token mappings
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

  // Process events step by step
  const sortedEvents = sortEventsByTimestamp(events);
  const state = createEmptyEngineState(wallet);

  // Track all activity by token
  const tokenActivity = new Map<string, {
    buys: PolymarketPnlEvent[];
    sells: PolymarketPnlEvent[];
    redemptions: PolymarketPnlEvent[];
    enginePnL: bigint;
  }>();

  for (const event of sortedEvents) {
    const tokenId = event.tokenId.toString();
    if (!tokenActivity.has(tokenId)) {
      tokenActivity.set(tokenId, { buys: [], sells: [], redemptions: [], enginePnL: 0n });
    }
    const act = tokenActivity.get(tokenId)!;

    if (event.eventType === 'ORDER_MATCHED_BUY') {
      act.buys.push(event);
    } else if (event.eventType === 'ORDER_MATCHED_SELL') {
      act.sells.push(event);
    } else if (event.eventType === 'REDEMPTION') {
      act.redemptions.push(event);
    }

    const beforePnl = state.realizedPnlRaw;
    applyEventToState(state, event);
    const deltaPnl = state.realizedPnlRaw - beforePnl;

    if (event.eventType === 'REDEMPTION') {
      act.enginePnL += deltaPnl;
    }
  }

  // Categorize tokens
  const pureWins: string[] = [];
  const pureLosses: string[] = [];
  const neutrals: string[] = [];
  const phantomSells: string[] = [];

  for (const [tokenId, act] of tokenActivity.entries()) {
    const hasBuys = act.buys.length > 0;
    const hasRedemptions = act.redemptions.length > 0;
    const hasOnlySells = !hasBuys && act.sells.length > 0;

    if (hasOnlySells) {
      phantomSells.push(tokenId);
    } else if (hasBuys && hasRedemptions) {
      const pnl = Number(act.enginePnL) / 1e6;
      if (pnl > 1) {
        pureWins.push(tokenId);
      } else if (pnl < -1) {
        pureLosses.push(tokenId);
      } else {
        neutrals.push(tokenId);
      }
    }
  }

  console.log('\n=== Token Categories ===');
  console.log('Pure wins:', pureWins.length);
  console.log('Pure losses:', pureLosses.length);
  console.log('Neutrals:', neutrals.length);
  console.log('Phantom sells:', phantomSells.length);

  // Show details of neutral/loss tokens
  console.log('\n=== Neutral Tokens (no PnL despite having buys) ===');
  for (const tokenId of neutrals.slice(0, 5)) {
    const act = tokenActivity.get(tokenId)!;
    const mapping = tokenToCondition.get(tokenId);
    const totalBuyUsdc = act.buys.reduce((sum, e) => sum + Number(e.usdcAmountRaw || 0), 0) / 1e6;
    const totalBuyTokens = act.buys.reduce((sum, e) => sum + Number(e.amount), 0) / 1e6;
    const redemptionPayout = act.redemptions[0]?.payoutPrice;

    console.log(`\nToken: ${tokenId.substring(0, 20)}...`);
    console.log(`  Condition: ${mapping?.conditionId.substring(0, 20) || 'N/A'}...`);
    console.log(`  Buys: ${act.buys.length}, Sells: ${act.sells.length}`);
    console.log(`  Total buy USDC: $${totalBuyUsdc.toFixed(2)}`);
    console.log(`  Total buy tokens: ${totalBuyTokens.toFixed(2)}`);
    console.log(`  Redemption payout: $${redemptionPayout ? (Number(redemptionPayout) / 1e6).toFixed(2) : 'N/A'}`);
    console.log(`  Engine PnL: $${(Number(act.enginePnL) / 1e6).toFixed(2)}`);
  }

  // Check for real sells (not phantom) that might have realized losses
  console.log('\n=== Sells WITH prior buys (potential loss realization) ===');
  let sellPnLTotal = 0n;

  for (const [tokenId, act] of tokenActivity.entries()) {
    if (act.buys.length > 0 && act.sells.length > 0) {
      const mapping = tokenToCondition.get(tokenId);
      const totalSellUsdc = act.sells.reduce((sum, e) => sum + Number(e.usdcAmountRaw || 0), 0) / 1e6;

      // Estimate PnL from sells (this is rough)
      console.log(`\nToken: ${tokenId.substring(0, 20)}...`);
      console.log(`  Condition: ${mapping?.conditionId.substring(0, 20) || 'N/A'}...`);
      console.log(`  Buys: ${act.buys.length}, Sells: ${act.sells.length}`);
      console.log(`  Total sell USDC: $${totalSellUsdc.toFixed(2)}`);
    }
  }

  // Calculate expected phantom sell losses
  console.log('\n=== Phantom Sell Analysis ===');
  let phantomSellProfit = 0;
  let phantomSellLoss = 0;

  for (const tokenId of phantomSells) {
    const act = tokenActivity.get(tokenId)!;
    const mapping = tokenToCondition.get(tokenId);
    const totalSellUsdc = act.sells.reduce((sum, e) => sum + Number(e.usdcAmountRaw || 0), 0) / 1e6;
    const redemptionPayout = act.redemptions[0]?.payoutPrice;
    const payoutValue = redemptionPayout ? Number(redemptionPayout) / 1e6 : 0;

    // If payout = 0, phantom sell was profitable (keep the USDC)
    // If payout = 1, phantom sell was a loss (owe the payout)
    if (payoutValue === 0) {
      phantomSellProfit += totalSellUsdc;
    } else {
      // Loss = (payout - sellPrice) × tokens sold
      const tokensSold = act.sells.reduce((sum, e) => sum + Number(e.amount), 0) / 1e6;
      const avgSellPrice = totalSellUsdc / tokensSold;
      const loss = (payoutValue - avgSellPrice) * tokensSold;
      phantomSellLoss += loss;
      console.log(`Token ${tokenId.substring(0, 15)}... payout=$${payoutValue.toFixed(2)} sellUsdc=$${totalSellUsdc.toFixed(2)} tokens=${tokensSold.toFixed(0)} LOSS=$${loss.toFixed(2)}`);
    }
  }

  console.log(`\nPhantom sell profit (payout=0): $${phantomSellProfit.toFixed(2)}`);
  console.log(`Phantom sell loss (payout>0): $${phantomSellLoss.toFixed(2)}`);

  // Final summary
  console.log('\n=== Summary ===');
  console.log(`Engine realized PnL: $${(Number(state.realizedPnlRaw) / 1e6).toFixed(2)}`);
  console.log(`Expected (PolymarketAnalytics): $5,454`);
  console.log(`Missing PnL: $${(5454 - Number(state.realizedPnlRaw) / 1e6).toFixed(2)}`);
}

debug().catch(console.error);
