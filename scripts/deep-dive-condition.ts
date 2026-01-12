/**
 * Deep Dive into a Specific Condition
 *
 * Looking at dd22472e... and c6485bb7... which have large unexplained cash flows
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
  const conditionId = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';

  console.log(`\n=== DEEP DIVE: ${conditionId} ===\n`);

  // Get all trades for this condition, in chronological order
  const result = await clickhouse.query({
    query: `
      SELECT
        toDateTime(t.trade_time) as time,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.usdc_amount) / max(t.token_amount) as price
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND lower(m.condition_id) = '${conditionId}'
      GROUP BY t.trade_time, m.outcome_index, t.side
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });

  const trades = await result.json() as any[];

  console.log('Chronological trades:');
  console.log('time                | idx | side | tokens  | usdc    | price');
  console.log('-'.repeat(70));

  let o0Balance = 0;  // token balance for outcome 0
  let o1Balance = 0;  // token balance for outcome 1
  let cashBalance = 0;  // cash balance

  for (const trade of trades) {
    const time = trade.time.substring(11, 19);
    const delta = trade.side === 'buy' ? trade.tokens : -trade.tokens;
    const cashDelta = trade.side === 'buy' ? -trade.usdc : trade.usdc;

    if (trade.outcome_index === 0) o0Balance += delta;
    else o1Balance += delta;
    cashBalance += cashDelta;

    console.log(
      `${time} | ${trade.outcome_index}   | ${trade.side.padEnd(4)} | ` +
      `${trade.tokens.toFixed(1).padStart(7)} | ` +
      `$${trade.usdc.toFixed(2).padStart(6)} | ` +
      `${trade.price.toFixed(4).padStart(6)} | ` +
      `O0=${o0Balance.toFixed(1)}, O1=${o1Balance.toFixed(1)}, Cash=$${cashBalance.toFixed(2)}`
    );
  }

  console.log(`\n=== FINAL STATE ===`);
  console.log(`O0 tokens: ${o0Balance.toFixed(2)}`);
  console.log(`O1 tokens: ${o1Balance.toFixed(2)}`);
  console.log(`Cash: $${cashBalance.toFixed(2)}`);

  // Check resolution
  const resResult = await clickhouse.query({
    query: `
      SELECT norm_prices, resolved_at
      FROM pm_condition_resolutions_norm
      WHERE lower(condition_id) = '${conditionId}'
    `,
    format: 'JSONEachRow',
  });

  const resRows = await resResult.json() as any[];
  if (resRows.length > 0) {
    console.log(`\nResolution: ${JSON.stringify(resRows[0].norm_prices)} @ ${resRows[0].resolved_at}`);
    const prices = resRows[0].norm_prices as number[];
    const positionValue = o0Balance * prices[0] + o1Balance * prices[1];
    console.log(`Position value at resolution: ${o0Balance.toFixed(2)} * ${prices[0]} + ${o1Balance.toFixed(2)} * ${prices[1]} = $${positionValue.toFixed(2)}`);
    console.log(`PnL = Cash + Position value = $${cashBalance.toFixed(2)} + $${positionValue.toFixed(2)} = $${(cashBalance + positionValue).toFixed(2)}`);
  }

  // Key question: If both O0 and O1 balances are negative, where did the tokens come from?
  // The ONLY way to have negative balance is if tokens came from outside CLOB (splits/mints)
  if (o0Balance < 0 && o1Balance < 0) {
    const minDeficit = Math.min(Math.abs(o0Balance), Math.abs(o1Balance));
    console.log(`\n=== SPLIT ANALYSIS ===`);
    console.log(`Both balances negative - tokens came from splits`);
    console.log(`Inferred split amount: ${minDeficit.toFixed(2)} token pairs`);
    console.log(`Split cost (at $1/pair): $${minDeficit.toFixed(2)}`);

    // Corrected PnL accounting for split cost
    const correctedPnl = cashBalance - minDeficit;
    console.log(`\nCorrected PnL = Cash - Split cost = $${cashBalance.toFixed(2)} - $${minDeficit.toFixed(2)} = $${correctedPnl.toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
