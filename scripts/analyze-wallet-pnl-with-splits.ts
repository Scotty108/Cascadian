import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = process.argv[2] || '0x282aa94cc5751f08dfb9be98fecbae84b7e19bce';

async function analyzeWalletPnL() {
  console.log('ACCURATE PNL WITH SPLIT COST BASIS FOR:', wallet);
  console.log('='.repeat(110));

  // Step 1: Get all token activity for this wallet
  const tokenQ = `
    SELECT
      token_id,
      sumIf(token_amount, side = 'buy') / 1e6 as bought,
      sumIf(token_amount, side = 'sell') / 1e6 as sold,
      sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
      sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
      AND is_deleted = 0
    GROUP BY token_id
  `;

  const tokenRes = await clickhouse.query({ query: tokenQ, format: 'JSONEachRow' });
  const tokens = (await tokenRes.json()) as any[];

  // Step 2: Get token mappings
  const tokenIds = tokens.map((t) => t.token_id);
  const mapQ = `
    SELECT token_id_dec, condition_id, outcome_index, question
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec IN ('${tokenIds.join("','")}')
  `;

  const mapRes = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapRes.json()) as any[];
  const tokenMap = new Map(mappings.map((m) => [m.token_id_dec, m]));

  // Step 3: Get resolutions
  const conditionIds = [...new Set(mappings.map((m) => m.condition_id))];
  const resQ = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id IN ('${conditionIds.join("','")}')
  `;

  const resRes = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resRes.json()) as any[];
  const resolutionMap = new Map(resolutions.map((r) => [r.condition_id, JSON.parse(r.payout_numerators)]));

  // Group by condition to handle split cost attribution
  const conditionData = new Map<
    string,
    {
      question: string;
      tokens: Array<{
        outcomeIndex: number;
        bought: number;
        sold: number;
        buyUsdc: number;
        sellUsdc: number;
      }>;
      payouts?: number[];
    }
  >();

  for (const t of tokens) {
    const mapping = tokenMap.get(t.token_id);
    if (!mapping) continue;

    const { condition_id, outcome_index, question } = mapping;

    if (!conditionData.has(condition_id)) {
      conditionData.set(condition_id, {
        question,
        tokens: [],
        payouts: resolutionMap.get(condition_id),
      });
    }

    conditionData.get(condition_id)!.tokens.push({
      outcomeIndex: outcome_index,
      bought: Number(t.bought),
      sold: Number(t.sold),
      buyUsdc: Number(t.buy_usdc),
      sellUsdc: Number(t.sell_usdc),
    });
  }

  console.log('');
  console.log('CONDITION-BY-CONDITION ANALYSIS:');
  console.log('='.repeat(110));

  let grandTotalPnL = 0;

  for (const [conditionId, data] of conditionData) {
    const shortQ = data.question.slice(0, 60);
    console.log(`\n${shortQ}`);
    console.log(`Condition: ${conditionId.slice(0, 20)}...`);
    console.log('-'.repeat(110));

    // Calculate phantom tokens (sold but not bought) per outcome
    let phantomTokensNeeded = 0;

    for (const tok of data.tokens) {
      const netTokens = tok.bought - tok.sold;
      if (netTokens < 0) {
        // Sold more than bought - these came from a split
        phantomTokensNeeded = Math.max(phantomTokensNeeded, Math.abs(netTokens));
      }
    }

    console.log(`Phantom tokens from external source: ${phantomTokensNeeded.toFixed(0)}`);

    // If phantom tokens exist, a split was done externally
    // Split cost = $1 per token pair (you get both YES and NO)
    const splitCost = phantomTokensNeeded; // $1 per pair
    console.log(`Implied split cost: $${splitCost.toFixed(0)}`);

    let conditionPnL = 0;

    for (const tok of data.tokens) {
      const netTokens = tok.bought - tok.sold;
      const cashFlow = tok.sellUsdc - tok.buyUsdc;

      // Determine held value at resolution
      let heldValue = 0;
      let status = 'OPEN';

      if (data.payouts) {
        const won = data.payouts[tok.outcomeIndex] === 1;
        status = won ? 'WON' : 'LOST';

        // Only tokens we actually HOLD can be redeemed
        // If netTokens > 0, we hold tokens
        // If netTokens < 0, we sold tokens we got from split (and don't hold them anymore)
        if (netTokens > 0) {
          heldValue = won ? netTokens : 0;
        } else {
          heldValue = 0; // Sold everything, nothing to redeem
        }
      }

      const positionPnL = cashFlow + heldValue;
      conditionPnL += positionPnL;

      console.log(
        `  Outcome ${tok.outcomeIndex}: Bought ${tok.bought.toFixed(0)} / Sold ${tok.sold.toFixed(0)} | ` +
          `Cash flow: $${cashFlow.toFixed(0)} | Held: ${netTokens.toFixed(0)} tokens | ` +
          `${status} | Held value: $${heldValue.toFixed(0)} | PnL: $${positionPnL.toFixed(0)}`
      );
    }

    // Subtract split cost
    conditionPnL -= splitCost;

    console.log(`  → Split cost: -$${splitCost.toFixed(0)}`);
    console.log(`  → CONDITION PNL: $${conditionPnL.toFixed(0)}`);

    grandTotalPnL += conditionPnL;
  }

  console.log('');
  console.log('='.repeat(110));
  console.log('GRAND TOTAL PNL:', grandTotalPnL.toFixed(2));
  console.log('');
  console.log('Polymarket UI shows: -$136,509');
  console.log('Difference:', (grandTotalPnL - -136509).toFixed(2));
}

analyzeWalletPnL().catch(console.error);
