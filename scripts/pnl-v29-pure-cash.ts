/**
 * PnL V29 - Pure Cash Flow Approach
 *
 * Let's think about this simply:
 *
 * Real cash flows:
 * 1. CLOB buys: Cash OUT
 * 2. CLOB sells: Cash IN
 * 3. Redemptions: Cash IN
 * 4. Splits: Cash OUT ($1 per pair)
 * 5. Merges: Cash IN ($1 per pair minus slippage)
 *
 * The issue is figuring out splits/merges from CLOB data alone.
 *
 * Key insight: If FINAL token position for BOTH outcomes is negative,
 * you MUST have done splits equal to min(|O0|, |O1|).
 *
 * But there's another subtlety: Neg Risk swaps don't have split cost.
 * When you do "sell O0 + buy O1" via CLOB:
 * - If you already owned O0 tokens (from splits or buys), no extra cost
 * - The CLOB cash flow is the real flow
 *
 * Let me trace through dd22472e more carefully:
 * - Final: O0=-138.5, O1=-72.5
 * - Resolution: [1,0] means O0 is worth $1
 *
 * If user had split 72.5 pairs:
 * - Cost: $72.5
 * - Got: 72.5 O0 + 72.5 O1
 *
 * Then through CLOB trading (including Neg Risk):
 * - Ended with -138.5 O0 (sold 72.5 from split + 66 more)
 * - Ended with -72.5 O1 (sold all 72.5 from split)
 *
 * Where did the extra 66 O0 come from?
 * Answer: Neg Risk swaps. "Sell O1, buy O0" creates O0 tokens.
 *
 * So the picture is:
 * 1. Split 72.5 pairs → -$72.5 cash
 * 2. Various CLOB trades → +$110.08 cash (already includes Neg Risk)
 * 3. Market resolves [1,0]
 * 4. User has -138.5 O0 (worth $138.5 at resolution) and -72.5 O1 (worth $0)
 *
 * But wait - you can't have negative tokens at resolution and owe money.
 * In Polymarket, positions are settled. If you have -138.5 O0 tokens,
 * that means you SHORT sold O0. When O0 wins at $1, you need to cover.
 *
 * Actually no - in prediction markets, you can't really "short" in the
 * traditional sense. You can only sell tokens you own.
 *
 * So if the final position is -138.5 O0, it means:
 * - Throughout trading, the NET effect was selling 138.5 O0
 * - Those tokens came from: (a) splits, (b) Neg Risk creating them, (c) buys
 *
 * Let me reconsider: What if Neg Risk trades are INTERNAL and don't
 * affect real cash? Then we should only count:
 * 1. Regular trades (non-Neg-Risk)
 * 2. Split costs
 * 3. Redemptions
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

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== PNL V29 - PURE CASH FLOW ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get all trades with timestamp
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

  const trades = await result.json() as any[];

  // Group trades by (time, condition) to identify Neg Risk pairs
  const byTimeCondition = new Map<string, any[]>();
  for (const trade of trades) {
    const key = `${trade.time}_${trade.condition_id}`;
    if (!byTimeCondition.has(key)) byTimeCondition.set(key, []);
    byTimeCondition.get(key)!.push(trade);
  }

  // Separate Neg Risk from regular trades
  let regularCashIn = 0;
  let regularCashOut = 0;
  let negRiskCashIn = 0;
  let negRiskCashOut = 0;

  // Track positions for split cost calculation
  interface Position { tokens: number; cash: number; }
  const positions = new Map<string, Position>();

  for (const [, group] of byTimeCondition) {
    const o0Trades = group.filter((t: any) => t.outcome_index === 0);
    const o1Trades = group.filter((t: any) => t.outcome_index === 1);

    // Check for Neg Risk pattern
    let isNegRisk = false;
    if (o0Trades.length > 0 && o1Trades.length > 0) {
      const priceSum = o0Trades[0].price + o1Trades[0].price;
      if (Math.abs(priceSum - 1.0) < 0.02) {
        isNegRisk = true;
      }
    }

    for (const trade of group) {
      const posKey = `${trade.condition_id}_${trade.outcome_index}`;
      let pos = positions.get(posKey);
      if (!pos) { pos = { tokens: 0, cash: 0 }; positions.set(posKey, pos); }

      const tokenDelta = trade.side === 'buy' ? trade.tokens : -trade.tokens;
      const cashDelta = trade.side === 'buy' ? -trade.usdc : trade.usdc;

      pos.tokens += tokenDelta;
      pos.cash += cashDelta;

      if (isNegRisk) {
        if (trade.side === 'buy') negRiskCashOut += trade.usdc;
        else negRiskCashIn += trade.usdc;
      } else {
        if (trade.side === 'buy') regularCashOut += trade.usdc;
        else regularCashIn += trade.usdc;
      }
    }
  }

  // Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout))/1e6 as total
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const redemptions = await redemptionResult.json() as any[];
  const totalRedemptions = redemptions[0]?.total ?? 0;

  // Calculate inferred splits from final positions
  // Group by condition
  const byCondition = new Map<string, { o0: number; o1: number }>();
  for (const [key, pos] of positions) {
    const [cid, oi] = key.split('_');
    if (!byCondition.has(cid)) byCondition.set(cid, { o0: 0, o1: 0 });
    const c = byCondition.get(cid)!;
    if (parseInt(oi) === 0) c.o0 = pos.tokens;
    else c.o1 = pos.tokens;
  }

  let totalSplitCost = 0;
  for (const [, { o0, o1 }] of byCondition) {
    if (o0 < -0.01 && o1 < -0.01) {
      totalSplitCost += Math.min(Math.abs(o0), Math.abs(o1));
    }
  }

  console.log(`\n=== CASH FLOW SUMMARY ===`);
  console.log(`Regular buys (out):  $${regularCashOut.toFixed(2)}`);
  console.log(`Regular sells (in):  $${regularCashIn.toFixed(2)}`);
  console.log(`Neg Risk buys (out): $${negRiskCashOut.toFixed(2)}`);
  console.log(`Neg Risk sells (in): $${negRiskCashIn.toFixed(2)}`);
  console.log(`Redemptions (in):    $${totalRedemptions.toFixed(2)}`);
  console.log(`Inferred splits:     $${totalSplitCost.toFixed(2)}`);

  // Try different formulas
  console.log(`\n=== FORMULA ATTEMPTS ===`);

  // F1: All trades + redemptions (no adjustment)
  const f1 = -regularCashOut + regularCashIn - negRiskCashOut + negRiskCashIn + totalRedemptions;
  console.log(`F1 (all trades + redemp): $${f1.toFixed(2)} | diff: $${(f1 - (apiPnl ?? 0)).toFixed(2)}`);

  // F2: Regular + redemptions only
  const f2 = -regularCashOut + regularCashIn + totalRedemptions;
  console.log(`F2 (regular + redemp): $${f2.toFixed(2)} | diff: $${(f2 - (apiPnl ?? 0)).toFixed(2)}`);

  // F3: All trades + redemptions - split cost
  const f3 = f1 - totalSplitCost;
  console.log(`F3 (all - splits): $${f3.toFixed(2)} | diff: $${(f3 - (apiPnl ?? 0)).toFixed(2)}`);

  // F4: Regular + redemptions - split cost
  const f4 = f2 - totalSplitCost;
  console.log(`F4 (regular - splits): $${f4.toFixed(2)} | diff: $${(f4 - (apiPnl ?? 0)).toFixed(2)}`);

  // F5: What if split cost should be applied to Neg Risk trades?
  // Neg Risk "buys" might represent the split cost
  const f5 = -regularCashOut + regularCashIn + totalRedemptions - negRiskCashOut;
  console.log(`F5 (regular + redemp - NR buys): $${f5.toFixed(2)} | diff: $${(f5 - (apiPnl ?? 0)).toFixed(2)}`);

  // F6: What if Neg Risk sells should be subtracted from redemptions?
  const f6 = -regularCashOut + regularCashIn + totalRedemptions - negRiskCashIn;
  console.log(`F6 (regular + redemp - NR sells): $${f6.toFixed(2)} | diff: $${(f6 - (apiPnl ?? 0)).toFixed(2)}`);

  console.log(`\n=== TARGET ===`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Show what adjustment is needed
  if (apiPnl !== null) {
    const adj = f2 - apiPnl;  // Using F2 as baseline (closest so far)
    console.log(`\nFrom F2, need to subtract: $${adj.toFixed(2)}`);
    console.log(`Split cost is: $${totalSplitCost.toFixed(2)}`);
    console.log(`Remaining: $${(adj - totalSplitCost).toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
