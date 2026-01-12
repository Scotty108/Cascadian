/**
 * PnL V29 Trace Splits
 *
 * Key insight from position tracking:
 * - Conditions with BOTH outcomes negative = full splits ($1 per pair)
 * - Conditions with ONE outcome negative = Neg Risk swap (O0 → O1 or vice versa)
 *
 * For Neg Risk swaps:
 * - If you sell O0 to buy O1, you're NOT spending $1 per token
 * - You're just swapping positions at market prices
 *
 * But wait - where do the initial tokens come from for the swap?
 * If you have -138.5 O0 and -72.5 O1:
 * 1. You split 72.5 pairs (cost: $72.5)
 * 2. You sold ALL O0 from splits (72.5) plus 66 more O0
 * 3. Where did those extra 66 O0 come from?
 *
 * Answer: You bought them via CLOB! So the "extra" negative tokens
 * represent tokens that were bought and then sold through Neg Risk.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

interface Trade {
  time: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  tokens: number;
  usdc: number;
  price: number;
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
  const targetCondition = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';

  console.log(`\n=== TRACE SPLITS FOR CONDITION ${targetCondition.substring(0, 20)}... ===\n`);

  const apiPnl = await fetchApiPnl(wallet);

  // Get all trades for this condition
  const result = await clickhouse.query({
    query: `
      SELECT
        toString(t.trade_time) as time,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.usdc_amount) / max(t.token_amount) as price
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND lower(m.condition_id) = '${targetCondition}'
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });

  const trades = await result.json() as Trade[];

  console.log('Chronological trades:');
  console.log('time     | idx | side | tokens   | usdc     | price  | O0 bal | O1 bal | cash');
  console.log('-'.repeat(90));

  let o0Balance = 0;
  let o1Balance = 0;
  let cashBalance = 0;

  for (const trade of trades) {
    const time = trade.time.substring(11, 19);

    if (trade.side === 'buy') {
      if (trade.outcome_index === 0) o0Balance += trade.tokens;
      else o1Balance += trade.tokens;
      cashBalance -= trade.usdc;
    } else {
      if (trade.outcome_index === 0) o0Balance -= trade.tokens;
      else o1Balance -= trade.tokens;
      cashBalance += trade.usdc;
    }

    console.log(
      `${time} | ${trade.outcome_index}   | ${trade.side.padEnd(4)} | ` +
      `${trade.tokens.toFixed(2).padStart(8)} | ` +
      `$${trade.usdc.toFixed(2).padStart(7)} | ` +
      `${trade.price.toFixed(4)} | ` +
      `${o0Balance.toFixed(1).padStart(6)} | ` +
      `${o1Balance.toFixed(1).padStart(6)} | ` +
      `$${cashBalance.toFixed(2)}`
    );
  }

  console.log(`\n=== FINAL STATE ===`);
  console.log(`O0 balance: ${o0Balance.toFixed(2)}`);
  console.log(`O1 balance: ${o1Balance.toFixed(2)}`);
  console.log(`Cash balance (from CLOB): $${cashBalance.toFixed(2)}`);

  // Analysis
  console.log(`\n=== ANALYSIS ===`);

  // If both balances are negative, splits must have occurred
  if (o0Balance < 0 && o1Balance < 0) {
    const minNeg = Math.min(Math.abs(o0Balance), Math.abs(o1Balance));
    console.log(`Both balances negative - ${minNeg.toFixed(2)} pairs were split`);
    console.log(`Split cost: $${minNeg.toFixed(2)}`);

    // The excess negative on one side came from Neg Risk swaps
    const o0Excess = Math.abs(o0Balance) - minNeg;
    const o1Excess = Math.abs(o1Balance) - minNeg;
    console.log(`O0 excess (from Neg Risk): ${o0Excess.toFixed(2)}`);
    console.log(`O1 excess (from Neg Risk): ${o1Excess.toFixed(2)}`);
  }

  // Now let's look at the c6485bb7 condition too
  console.log(`\n\n=== TRACE CONDITION c6485bb7... ===\n`);

  const targetCondition2 = 'c6485bb7ea46d7bb89beb3653f87b0b2ed439db4df3c83c06d4801a9d4a00d22';

  const result2 = await clickhouse.query({
    query: `
      SELECT
        toString(t.trade_time) as time,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.usdc_amount) / max(t.token_amount) as price
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND lower(m.condition_id) = '${targetCondition2}'
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });

  const trades2 = await result2.json() as Trade[];

  console.log('time     | idx | side | tokens   | usdc     | price  | O0 bal | O1 bal | cash');
  console.log('-'.repeat(90));

  o0Balance = 0;
  o1Balance = 0;
  cashBalance = 0;

  for (const trade of trades2) {
    const time = trade.time.substring(11, 19);

    if (trade.side === 'buy') {
      if (trade.outcome_index === 0) o0Balance += trade.tokens;
      else o1Balance += trade.tokens;
      cashBalance -= trade.usdc;
    } else {
      if (trade.outcome_index === 0) o0Balance -= trade.tokens;
      else o1Balance -= trade.tokens;
      cashBalance += trade.usdc;
    }

    console.log(
      `${time} | ${trade.outcome_index}   | ${trade.side.padEnd(4)} | ` +
      `${trade.tokens.toFixed(2).padStart(8)} | ` +
      `$${trade.usdc.toFixed(2).padStart(7)} | ` +
      `${trade.price.toFixed(4)} | ` +
      `${o0Balance.toFixed(1).padStart(6)} | ` +
      `${o1Balance.toFixed(1).padStart(6)} | ` +
      `$${cashBalance.toFixed(2)}`
    );
  }

  console.log(`\n=== FINAL STATE ===`);
  console.log(`O0 balance: ${o0Balance.toFixed(2)}`);
  console.log(`O1 balance: ${o1Balance.toFixed(2)}`);
  console.log(`Cash balance (from CLOB): $${cashBalance.toFixed(2)}`);

  if (o0Balance < 0 && o1Balance < 0) {
    const minNeg = Math.min(Math.abs(o0Balance), Math.abs(o1Balance));
    console.log(`\nBoth balances negative - ${minNeg.toFixed(2)} pairs were split`);
    console.log(`Split cost: $${minNeg.toFixed(2)}`);

    const o0Excess = Math.abs(o0Balance) - minNeg;
    const o1Excess = Math.abs(o1Balance) - minNeg;
    console.log(`O0 excess (from Neg Risk): ${o0Excess.toFixed(2)}`);
    console.log(`O1 excess (from Neg Risk): ${o1Excess.toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
