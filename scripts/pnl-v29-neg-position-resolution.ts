/**
 * PnL V29 - Negative Position Resolution
 *
 * CRITICAL INSIGHT: If you have NEGATIVE tokens when a market resolves,
 * and that outcome wins (price=1), you OWE money!
 *
 * Example: dd22472e resolves [1,0] meaning O0 wins
 * - User has -138.5 O0 tokens
 * - At resolution, each O0 token is worth $1
 * - User owes: 138.5 * $1 = $138.5
 *
 * But wait - the user already RECEIVED cash from selling those tokens.
 * The "split and sell" strategy is:
 * 1. Split $72.5 to get 72.5 O0 + 72.5 O1
 * 2. Sell O0 at ~0.64, sell O1 at ~0.36
 * 3. Receive ~$72.5 total (break even on the split)
 * 4. But also do Neg Risk swaps to sell MORE tokens
 *
 * The key question: When you sell tokens you don't have (via Neg Risk),
 * what is the real PnL impact?
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

  console.log(`\n=== PNL V29 - NEGATIVE POSITION RESOLUTION ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get all trades grouped by condition
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens,
        max(t.usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
    `,
    format: 'JSONEachRow',
  });

  const trades = await result.json() as any[];

  // Build positions
  interface ConditionState {
    o0Tokens: number;
    o1Tokens: number;
    o0Cash: number;
    o1Cash: number;
  }

  const conditions = new Map<string, ConditionState>();

  for (const trade of trades) {
    let state = conditions.get(trade.condition_id);
    if (!state) {
      state = { o0Tokens: 0, o1Tokens: 0, o0Cash: 0, o1Cash: 0 };
      conditions.set(trade.condition_id, state);
    }

    const tokenDelta = trade.side === 'buy' ? trade.tokens : -trade.tokens;
    const cashDelta = trade.side === 'buy' ? -trade.usdc : trade.usdc;

    if (trade.outcome_index === 0) {
      state.o0Tokens += tokenDelta;
      state.o0Cash += cashDelta;
    } else {
      state.o1Tokens += tokenDelta;
      state.o1Cash += cashDelta;
    }
  }

  // Get resolutions
  const conditionIds = Array.from(conditions.keys());
  const idList = conditionIds.map(id => `'${id}'`).join(',');

  const resolutions = new Map<string, number[]>();
  if (conditionIds.length > 0) {
    const resResult = await clickhouse.query({
      query: `
        SELECT lower(condition_id) as condition_id, norm_prices
        FROM pm_condition_resolutions_norm
        WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
      `,
      format: 'JSONEachRow',
    });

    const resRows = await resResult.json() as { condition_id: string; norm_prices: number[] }[];
    for (const row of resRows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  // Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        lower(cid) as condition_id,
        sum(toFloat64OrZero(amount_or_payout))/1e6 as payout_amount
      FROM (
        SELECT lower(condition_id) as cid, amount_or_payout
        FROM pm_ctf_events
        WHERE lower(user_address) = '${wallet.toLowerCase()}'
          AND event_type = 'PayoutRedemption'
          AND is_deleted = 0
      )
      GROUP BY cid
    `,
    format: 'JSONEachRow',
  });

  const redemptions = await redemptionResult.json() as any[];
  const redemptionByCondition = new Map<string, number>();
  for (const r of redemptions) {
    redemptionByCondition.set(r.condition_id, r.payout_amount);
  }

  // Analyze each condition with new understanding
  console.log(`\n=== CONDITION ANALYSIS (With Negative Position Liability) ===`);
  console.log('condition                 | O0 tok | O1 tok | cash   | res    | neg liability | redemp | PnL');
  console.log('-'.repeat(110));

  let totalPnl = 0;

  for (const [conditionId, state] of conditions) {
    const cash = state.o0Cash + state.o1Cash;
    const prices = resolutions.get(conditionId);
    const redemption = redemptionByCondition.get(conditionId) ?? 0;

    // Calculate negative position liability
    // If you have negative tokens when the market resolves, you owe money
    let negLiability = 0;
    if (prices) {
      if (state.o0Tokens < 0 && prices[0] > 0) {
        negLiability += Math.abs(state.o0Tokens) * prices[0];
      }
      if (state.o1Tokens < 0 && prices[1] > 0) {
        negLiability += Math.abs(state.o1Tokens) * prices[1];
      }
    }

    // PnL formula:
    // 1. Cash received from trading
    // 2. + Redemptions (positive tokens redeemed)
    // 3. - Negative position liability (money owed at resolution)
    const conditionPnl = cash + redemption - negLiability;

    totalPnl += conditionPnl;

    const resStr = prices ? `[${prices.join(',')}]` : 'unres';

    if (Math.abs(conditionPnl) > 1 || negLiability > 0 || redemption > 0) {
      console.log(
        `${conditionId.substring(0, 24)}... | ` +
        `${state.o0Tokens.toFixed(1).padStart(6)} | ` +
        `${state.o1Tokens.toFixed(1).padStart(6)} | ` +
        `$${cash.toFixed(2).padStart(5)} | ` +
        `${resStr.padStart(6)} | ` +
        `$${negLiability.toFixed(2).padStart(12)} | ` +
        `$${redemption.toFixed(2).padStart(5)} | ` +
        `$${conditionPnl.toFixed(2)}`
      );
    }
  }

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Calculated PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

main().catch(console.error);
