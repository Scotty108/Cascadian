/**
 * Calculate P&L without needing token→condition mapping
 *
 * Uses cost basis approach for held tokens since we can't get current market prices
 * for these unmapped 15-minute crypto markets.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== P&L CALCULATION WITHOUT TOKEN MAPPING ===\n');
  console.log(`Wallet: ${WALLET}\n`);

  // Get per-token stats
  console.log('1. Per-token analysis...');
  const q1 = `
    SELECT
      token_id,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as sold,
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as usdc_bought,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as usdc_sold
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    GROUP BY token_id
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const tokenStats = (await r1.json()) as {
    token_id: string;
    bought: string;
    sold: string;
    usdc_bought: string;
    usdc_sold: string;
  }[];

  // Calculate per-token metrics
  let totalBuys = 0;
  let totalSells = 0;
  let tokenDeficit = 0;
  let tokenSurplus = 0;
  let heldAtCost = 0;
  let heldAtLastPrice = 0;

  const surplusTokens: {
    token_id: string;
    held: number;
    avgBuyPrice: number;
    lastTradePrice: number;
  }[] = [];

  for (const t of tokenStats) {
    const bought = parseFloat(t.bought);
    const sold = parseFloat(t.sold);
    const usdcBought = parseFloat(t.usdc_bought);
    const usdcSold = parseFloat(t.usdc_sold);

    totalBuys += usdcBought;
    totalSells += usdcSold;

    if (sold > bought) {
      // Token deficit (from splits)
      tokenDeficit += sold - bought;
    } else if (bought > sold) {
      // Token surplus (held positions)
      const held = bought - sold;
      const avgBuyPrice = bought > 0 ? usdcBought / bought : 0;
      tokenSurplus += held;
      heldAtCost += held * avgBuyPrice;

      surplusTokens.push({
        token_id: t.token_id,
        held,
        avgBuyPrice,
        lastTradePrice: 0, // Will fill in
      });
    }
  }

  console.log(`  Total tokens: ${tokenStats.length}`);
  console.log(`  Tokens with surplus: ${surplusTokens.length}`);
  console.log(`  Tokens with deficit: ${tokenStats.length - surplusTokens.length}`);

  // Get last trade price for each surplus token
  console.log('\n2. Getting last trade prices for held tokens...');
  for (const st of surplusTokens.slice(0, 20)) {
    const q = `
      SELECT
        usdc_amount / token_amount as price
      FROM pm_trader_events_v2
      WHERE token_id = '${st.token_id}'
        AND is_deleted = 0
      ORDER BY trade_time DESC
      LIMIT 1
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = (await r.json()) as { price: string }[];
    if (rows.length > 0) {
      st.lastTradePrice = parseFloat(rows[0].price);
      heldAtLastPrice += st.held * st.lastTradePrice;
    }
  }

  console.log('Top 5 held positions:');
  for (const st of surplusTokens.slice(0, 5)) {
    console.log(
      `  ${st.token_id.slice(0, 20)}... | held: ${st.held.toFixed(2)} | cost: $${st.avgBuyPrice.toFixed(4)} | last: $${st.lastTradePrice.toFixed(4)}`
    );
  }

  // Get redemptions from CTF
  console.log('\n3. Getting CTF redemptions...');
  const q3 = `
    SELECT sum(toFloat64(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE user_address = '${WALLET}'
      AND event_type = 'PayoutRedemption'
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const redemptions = parseFloat(((await r3.json())[0] as { redemptions: string }).redemptions);
  console.log(`  Redemptions: $${redemptions.toFixed(2)}`);

  // Calculate P&L
  console.log('\n' + '='.repeat(60));
  console.log('P&L CALCULATION');
  console.log('='.repeat(60));

  console.log('\nCash Flows:');
  console.log(`  CLOB Buys:       -$${totalBuys.toFixed(2)}`);
  console.log(`  CLOB Sells:      +$${totalSells.toFixed(2)}`);
  console.log(`  CTF Redemptions: +$${redemptions.toFixed(2)}`);
  console.log(`  Split Costs:     -$${tokenDeficit.toFixed(2)} (${tokenDeficit.toFixed(2)} tokens @ $1)`);

  const realizedPnL = totalSells - totalBuys + redemptions - tokenDeficit;
  console.log(`  ----------------------------------------`);
  console.log(`  Realized P&L:    $${realizedPnL.toFixed(2)}`);

  console.log('\nHeld Tokens:');
  console.log(`  Tokens held:     ${tokenSurplus.toFixed(2)}`);
  console.log(`  Value at cost:   $${heldAtCost.toFixed(2)}`);
  console.log(`  Value at last:   $${heldAtLastPrice.toFixed(2)}`);

  console.log('\nTotal P&L Options:');
  console.log(`  At cost basis:   $${(realizedPnL + heldAtCost).toFixed(2)}`);
  console.log(`  At last price:   $${(realizedPnL + heldAtLastPrice).toFixed(2)}`);
  console.log(`  Realized only:   $${realizedPnL.toFixed(2)}`);

  console.log('\n' + '='.repeat(60));
  console.log('GROUND TRUTH COMPARISON');
  console.log('='.repeat(60));
  const groundTruth = -86.66;
  console.log(`  Ground truth:    $${groundTruth.toFixed(2)}`);
  console.log(`  Gap (at cost):   $${(groundTruth - (realizedPnL + heldAtCost)).toFixed(2)}`);
  console.log(`  Gap (at last):   $${(groundTruth - (realizedPnL + heldAtLastPrice)).toFixed(2)}`);

  // What held token value would match ground truth?
  const impliedHeldValue = groundTruth - realizedPnL;
  const impliedAvgPrice = impliedHeldValue / tokenSurplus;
  console.log(`\nTo match ground truth:`);
  console.log(`  Held value needed: $${impliedHeldValue.toFixed(2)}`);
  console.log(`  Implied avg price: $${impliedAvgPrice.toFixed(4)} per token`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
