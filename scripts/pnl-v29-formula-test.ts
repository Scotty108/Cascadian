/**
 * PnL V29 Formula Test - Testing Different Formulas
 *
 * The key insight: When you do a Neg Risk swap (sell O0 + buy O1),
 * you're not exchanging cash - you're exchanging positions. BUT,
 * the positions you receive have a cost basis equal to what you paid
 * for the original tokens you swapped away.
 *
 * Hypothesis: The $243 discrepancy might be explained by:
 * 1. The buy side of Neg Risk trades represents real cost for tokens received
 * 2. When those tokens are redeemed, the cost basis needs to be subtracted
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

  console.log(`\n=== PNL V29 FORMULA TEST FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get all trades with timestamp precision
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
        AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });

  const trades = await result.json() as Trade[];

  // Group by (time, condition_id) to identify Neg Risk pairs
  const byTimeCondition = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = `${trade.time}_${trade.condition_id}`;
    if (!byTimeCondition.has(key)) byTimeCondition.set(key, []);
    byTimeCondition.get(key)!.push(trade);
  }

  // Categorize trades and track cash flows
  let negRiskBuys = 0;
  let negRiskSells = 0;
  let regularBuys = 0;
  let regularSells = 0;

  for (const [, group] of byTimeCondition) {
    const o0Trades = group.filter(t => t.outcome_index === 0);
    const o1Trades = group.filter(t => t.outcome_index === 1);

    // Check for Neg Risk pattern
    if (o0Trades.length > 0 && o1Trades.length > 0) {
      const o0 = o0Trades[0];
      const o1 = o1Trades[0];
      const priceSum = o0.price + o1.price;

      if (Math.abs(priceSum - 1.0) < 0.02) {
        // This is a Neg Risk trade
        for (const t of [...o0Trades, ...o1Trades]) {
          if (t.side === 'buy') negRiskBuys += t.usdc;
          else negRiskSells += t.usdc;
        }
        continue;
      }
    }

    // Regular trades
    for (const trade of group) {
      if (trade.side === 'buy') regularBuys += trade.usdc;
      else regularSells += trade.usdc;
    }
  }

  // Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout))/1e6 as total_redemptions
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });

  const redemptionRows = await redemptionResult.json() as any[];
  const totalRedemptions = redemptionRows[0]?.total_redemptions ?? 0;

  console.log(`\n=== CASH FLOW BREAKDOWN ===`);
  console.log(`Regular buys:    $${regularBuys.toFixed(2)}`);
  console.log(`Regular sells:   $${regularSells.toFixed(2)}`);
  console.log(`Neg Risk buys:   $${negRiskBuys.toFixed(2)}`);
  console.log(`Neg Risk sells:  $${negRiskSells.toFixed(2)}`);
  console.log(`Redemptions:     $${totalRedemptions.toFixed(2)}`);

  console.log(`\n=== FORMULA TESTS ===`);

  // Formula 1: All cash flows
  const f1 = -regularBuys + regularSells - negRiskBuys + negRiskSells + totalRedemptions;
  console.log(`F1 (all cash): $${f1.toFixed(2)} | diff: $${apiPnl !== null ? (f1 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 2: Regular only + redemptions
  const f2 = -regularBuys + regularSells + totalRedemptions;
  console.log(`F2 (regular + redemptions): $${f2.toFixed(2)} | diff: $${apiPnl !== null ? (f2 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 3: Regular + Neg Risk net + redemptions
  const negRiskNet = negRiskSells - negRiskBuys;
  const f3 = -regularBuys + regularSells + negRiskNet + totalRedemptions;
  console.log(`F3 (regular + NR net + redemp): $${f3.toFixed(2)} | diff: $${apiPnl !== null ? (f3 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 4: Only count buy cost, ignore sell revenue from Neg Risk
  // Hypothesis: When you swap O0→O1, you pay O1 price for tokens
  // The sell of O0 isn't real cash - it's just clearing your position
  const f4 = -regularBuys + regularSells - negRiskBuys + totalRedemptions;
  console.log(`F4 (ignore NR sells): $${f4.toFixed(2)} | diff: $${apiPnl !== null ? (f4 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 5: Only count sell revenue, ignore buy cost from Neg Risk
  // Hypothesis: When you swap O0→O1, you receive cash for O0, tokens for O1
  const f5 = -regularBuys + regularSells + negRiskSells + totalRedemptions;
  console.log(`F5 (ignore NR buys): $${f5.toFixed(2)} | diff: $${apiPnl !== null ? (f5 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 6: Subtract Neg Risk "arbitrage" cost
  // The difference between NR sells and buys represents slippage/cost
  const f6 = -regularBuys + regularSells + (negRiskSells - negRiskBuys) + totalRedemptions;
  console.log(`F6 (NR slippage only): $${f6.toFixed(2)} | diff: $${apiPnl !== null ? (f6 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 7: What if redemptions have embedded Neg Risk cost?
  // Adjusted redemption = redemption - NR buy cost
  const f7 = -regularBuys + regularSells + (totalRedemptions - negRiskBuys);
  console.log(`F7 (redemp - NR buys): $${f7.toFixed(2)} | diff: $${apiPnl !== null ? (f7 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 8: Net regular + redemptions - all NR activity
  const f8 = regularSells - regularBuys + totalRedemptions - negRiskBuys - negRiskSells;
  console.log(`F8 (subtract all NR): $${f8.toFixed(2)} | diff: $${apiPnl !== null ? (f8 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 9: What if NR sells represent the "value" that should offset redemptions?
  // Like: You sold tokens through NR, then redeemed different tokens
  const f9 = regularSells - regularBuys + totalRedemptions - negRiskSells;
  console.log(`F9 (redemp - NR sells): $${f9.toFixed(2)} | diff: $${apiPnl !== null ? (f9 - apiPnl).toFixed(2) : 'N/A'}`);

  // Formula 10: Pure redemption minus all trading costs
  const f10 = totalRedemptions - regularBuys - negRiskBuys + regularSells + negRiskSells;
  console.log(`F10 (redemp + net trades): $${f10.toFixed(2)} | diff: $${apiPnl !== null ? (f10 - apiPnl).toFixed(2) : 'N/A'}`);

  console.log(`\n=== TARGET ===`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Let's compute what the missing piece would need to be
  if (apiPnl !== null) {
    const totalNet = regularSells - regularBuys;
    const neededAdjustment = apiPnl - totalNet - totalRedemptions;
    console.log(`\nTo match API:`);
    console.log(`  Regular net: $${totalNet.toFixed(2)}`);
    console.log(`  Redemptions: $${totalRedemptions.toFixed(2)}`);
    console.log(`  Sum: $${(totalNet + totalRedemptions).toFixed(2)}`);
    console.log(`  Needed adjustment: $${neededAdjustment.toFixed(2)}`);
    console.log(`  Compare to NR buys: $${(-negRiskBuys).toFixed(2)}`);
    console.log(`  Compare to NR sells: $${(-negRiskSells).toFixed(2)}`);
    console.log(`  Compare to NR net: $${(negRiskSells - negRiskBuys).toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
