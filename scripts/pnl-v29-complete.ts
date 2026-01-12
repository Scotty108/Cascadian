/**
 * PnL V29 Complete - Proper Split Cost Accounting
 *
 * DISCOVERY: Looking at trade traces for conditions with both outcomes negative:
 *
 * Condition dd22472e:
 * - Final: O0=-138.50, O1=-72.51, Cash=$110.08
 * - Split pairs: 72.51 (min of both negatives)
 * - Split cost: $72.51
 *
 * Condition c6485bb7:
 * - Final: O0=-72.63, O1=-264.66, Cash=$195.03
 * - Split pairs: 72.63 (min of both negatives)
 * - Split cost: $72.63
 *
 * The pattern: When BOTH outcomes are negative for a condition:
 * 1. User minted token pairs via splits (cost $1 per pair)
 * 2. User traded both outcomes on CLOB (cash flows recorded)
 * 3. But the "cash" from selling split tokens is offset by the split cost
 *
 * So for each condition:
 * - If O0 < 0 AND O1 < 0: split_cost = min(|O0|, |O1|)
 * - Adjusted cash = CLOB cash - split_cost
 *
 * For resolved positions:
 * - If redemption exists: PnL = redemption + adjusted_cash - split_cost
 * - If no redemption but resolved: PnL = position_value + adjusted_cash - split_cost
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
  condition_id: string;
  outcome_index: number;
  side: string;
  tokens: number;
  usdc: number;
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== PNL V29 COMPLETE FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get all trades
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

  const trades = await result.json() as Trade[];

  // Build positions per condition
  interface ConditionState {
    o0Tokens: number;
    o1Tokens: number;
    o0Cash: number;  // positive = received, negative = paid
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

  // Get resolutions
  const conditionIds = Array.from(conditions.keys());
  const idList = conditionIds.map(id => `'${id}'`).join(',');

  let resolutions = new Map<string, number[]>();
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

  // Calculate PnL per condition with proper split cost accounting
  console.log(`\n=== CONDITION BREAKDOWN ===`);
  console.log('condition                 | O0 tok | O1 tok | cash   | split  | redemp | pos val | PnL');
  console.log('-'.repeat(100));

  let totalPnl = 0;
  let totalSplitCost = 0;
  let totalCash = 0;
  let totalRedemptions = 0;
  let totalPositionValue = 0;

  for (const [conditionId, state] of conditions) {
    const cash = state.o0Cash + state.o1Cash;
    const redemption = redemptionByCondition.get(conditionId) ?? 0;
    const prices = resolutions.get(conditionId);

    // Calculate split cost: if BOTH outcomes negative, we split token pairs
    let splitCost = 0;
    if (state.o0Tokens < -0.01 && state.o1Tokens < -0.01) {
      splitCost = Math.min(Math.abs(state.o0Tokens), Math.abs(state.o1Tokens));
    }

    // Calculate position value for remaining tokens
    let positionValue = 0;
    if (redemption === 0) {  // Only if not redeemed
      if (state.o0Tokens > 0.01 && prices && prices[0] !== undefined) {
        positionValue += state.o0Tokens * prices[0];
      }
      if (state.o1Tokens > 0.01 && prices && prices[1] !== undefined) {
        positionValue += state.o1Tokens * prices[1];
      }
    }

    // PnL = cash - split_cost + redemption + position_value
    const conditionPnl = cash - splitCost + redemption + positionValue;

    totalCash += cash;
    totalSplitCost += splitCost;
    totalRedemptions += redemption;
    totalPositionValue += positionValue;
    totalPnl += conditionPnl;

    if (Math.abs(conditionPnl) > 1 || splitCost > 0 || redemption > 0) {
      console.log(
        `${conditionId.substring(0, 24)}... | ` +
        `${state.o0Tokens.toFixed(1).padStart(6)} | ` +
        `${state.o1Tokens.toFixed(1).padStart(6)} | ` +
        `$${cash.toFixed(2).padStart(5)} | ` +
        `$${splitCost.toFixed(2).padStart(5)} | ` +
        `$${redemption.toFixed(2).padStart(5)} | ` +
        `$${positionValue.toFixed(2).padStart(6)} | ` +
        `$${conditionPnl.toFixed(2)}`
      );
    }
  }

  console.log(`\n=== TOTALS ===`);
  console.log(`Total CLOB cash: $${totalCash.toFixed(2)}`);
  console.log(`Total split cost: $${totalSplitCost.toFixed(2)}`);
  console.log(`Total redemptions: $${totalRedemptions.toFixed(2)}`);
  console.log(`Total position value: $${totalPositionValue.toFixed(2)}`);

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Calculated PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // Breakdown of what's needed
  if (apiPnl !== null) {
    const needed = totalPnl - apiPnl;
    console.log(`\nTo match API, need to subtract: $${needed.toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
