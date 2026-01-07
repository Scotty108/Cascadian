import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xda5fff24aa9d889d6366da205029c73093102e9b';
const condition = 'c0bfbec1'; // From the sample - multiple trades

async function analyze() {
  // Get all trades for this wallet on this condition
  const q = `
    SELECT
      any(f.transaction_hash) as tx_hash,
      any(f.token_id) as token_id,
      any(f.side) as side,
      any(f.token_amount) / 1e6 as tokens,
      any(f.usdc_amount) / 1e6 as usdc,
      any(f.trade_time) as trade_time,
      any(m.outcome_index) as outcome_index
    FROM pm_trader_events_v2 f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}')
      AND f.is_deleted = 0
      AND lower(m.condition_id) LIKE '${condition}%'
    GROUP BY f.event_id
    ORDER BY trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const fills = (await r.json()) as any[];

  console.log(`=== Condition ${condition}% All Trades ===`);
  console.log('Time | Side | Outcome | Tokens | USDC | Price');
  console.log('-'.repeat(70));

  let o0Bought = 0,
    o0Sold = 0,
    o1Bought = 0,
    o1Sold = 0;
  let o0BuySpend = 0,
    o0SellReceive = 0,
    o1BuySpend = 0,
    o1SellReceive = 0;

  for (const f of fills) {
    const price = Number(f.tokens) > 0 ? (Number(f.usdc) / Number(f.tokens)).toFixed(3) : '?';
    const time = String(f.trade_time).slice(0, 16);
    console.log(
      `${time} | ${f.side.padEnd(4)} | ${String(f.outcome_index).padStart(7)} | ${Number(f.tokens).toFixed(2).padStart(8)} | $${Number(f.usdc).toFixed(2).padStart(8)} | ${price}`
    );

    const outcome = Number(f.outcome_index);
    const tokens = Number(f.tokens);
    const usdc = Number(f.usdc);

    if (outcome === 0) {
      if (f.side === 'buy') {
        o0Bought += tokens;
        o0BuySpend += usdc;
      } else {
        o0Sold += tokens;
        o0SellReceive += usdc;
      }
    } else {
      if (f.side === 'buy') {
        o1Bought += tokens;
        o1BuySpend += usdc;
      } else {
        o1Sold += tokens;
        o1SellReceive += usdc;
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(
    `Outcome 0: Bought ${o0Bought.toFixed(2)} @ $${o0BuySpend.toFixed(2)}, Sold ${o0Sold.toFixed(2)} @ $${o0SellReceive.toFixed(2)}`
  );
  console.log(
    `Outcome 1: Bought ${o1Bought.toFixed(2)} @ $${o1BuySpend.toFixed(2)}, Sold ${o1Sold.toFixed(2)} @ $${o1SellReceive.toFixed(2)}`
  );
  console.log(`\nNet Position: O0=${(o0Bought - o0Sold).toFixed(2)}, O1=${(o1Bought - o1Sold).toFixed(2)}`);
  const netCash = o0SellReceive - o0BuySpend + o1SellReceive - o1BuySpend;
  console.log(`Net Cash: $${netCash.toFixed(2)}`);

  // Check resolution
  const resQ = `SELECT payout_numerators FROM pm_condition_resolutions WHERE lower(condition_id) LIKE '${condition}%'`;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const res = (await resR.json()) as any[];

  if (res.length > 0) {
    console.log(`\nResolution: ${res[0].payout_numerators}`);
    const payouts = JSON.parse(res[0].payout_numerators.replace(/'/g, '"'));
    const o0Payout = payouts[0] > 0 ? 1 : 0;
    const o1Payout = payouts[1] > 0 ? 1 : 0;

    const o0NetTokens = o0Bought - o0Sold;
    const o1NetTokens = o1Bought - o1Sold;
    const resolutionValue = o0NetTokens * o0Payout + o1NetTokens * o1Payout;

    console.log(`Resolution value: $${resolutionValue.toFixed(2)}`);
    console.log(`Total PnL = Net Cash + Resolution = $${(netCash + resolutionValue).toFixed(2)}`);
  } else {
    console.log('\nNot resolved yet');
  }
}

analyze().catch(console.error);
