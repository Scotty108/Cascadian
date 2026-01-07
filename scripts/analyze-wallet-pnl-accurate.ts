import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = process.argv[2] || '0x282aa94cc5751f08dfb9be98fecbae84b7e19bce';

async function analyzeWalletPnL() {
  console.log('ACCURATE PNL CALCULATION FOR:', wallet);
  console.log('='.repeat(100));

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

  console.log('Unique tokens traded:', tokens.length);

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

  // Step 4: Calculate PnL
  console.log('');
  console.log('POSITION BREAKDOWN:');
  console.log('-'.repeat(130));
  console.log(
    'Question'.padEnd(42) +
      ' | Outcome | Bought   | Sold     | Net Tok  | Buy $    | Sell $   | Status | Held $   | PnL'
  );
  console.log('-'.repeat(130));

  let totalCashFlow = 0;
  let totalHeldValue = 0;
  let totalRealizedPnL = 0;

  for (const t of tokens) {
    const mapping = tokenMap.get(t.token_id);
    const bought = Number(t.bought);
    const sold = Number(t.sold);
    const netTokens = bought - sold;
    const buyUsdc = Number(t.buy_usdc);
    const sellUsdc = Number(t.sell_usdc);

    totalCashFlow += sellUsdc - buyUsdc;

    const shortQ = (mapping?.question || 'Unknown').slice(0, 40);
    const outcomeIdx = mapping?.outcome_index ?? '?';
    const conditionId = mapping?.condition_id;

    let status = 'OPEN';
    let heldValue = 0;

    if (conditionId && resolutionMap.has(conditionId)) {
      const payouts = resolutionMap.get(conditionId);
      const thisOutcomeWon = payouts[outcomeIdx] === 1;
      status = thisOutcomeWon ? 'WON' : 'LOST';

      // If this outcome won, held tokens are worth $1 each
      // If this outcome lost, held tokens are worth $0
      heldValue = thisOutcomeWon ? netTokens : 0;
    } else {
      // Open position - tokens have some value
      // For accurate current value, we'd need current market price
      // For now, estimate at 50% (this is a simplification)
      heldValue = netTokens > 0 ? netTokens * 0.5 : 0;
      status = 'OPEN';
    }

    totalHeldValue += heldValue;

    const positionPnL = sellUsdc - buyUsdc + heldValue;
    totalRealizedPnL += positionPnL;

    console.log(
      `${shortQ.padEnd(42)} | ${String(outcomeIdx).padEnd(7)} | ${bought.toFixed(0).padStart(8)} | ${sold.toFixed(0).padStart(8)} | ${netTokens.toFixed(0).padStart(8)} | $${buyUsdc.toFixed(0).padStart(7)} | $${sellUsdc.toFixed(0).padStart(7)} | ${status.padEnd(6)} | $${heldValue.toFixed(0).padStart(7)} | $${positionPnL.toFixed(0)}`
    );
  }

  console.log('='.repeat(130));
  console.log('');
  console.log('SUMMARY:');
  console.log('Total Cash Flow (Sell - Buy):', totalCashFlow.toFixed(2));
  console.log('Value of Held Tokens:', totalHeldValue.toFixed(2));
  console.log('');
  console.log('CALCULATED PnL = Cash Flow + Held Value');
  console.log('Our PnL:', totalRealizedPnL.toFixed(2));
  console.log('');
  console.log('Polymarket UI shows: -$136,509');
  console.log('Difference:', (totalRealizedPnL - -136509).toFixed(2));
}

analyzeWalletPnL().catch(console.error);
