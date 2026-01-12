/**
 * PnL V29 - Correct Formula with Redemption Awareness
 *
 * Key insight: CLOB data is historical and doesn't reflect redemptions.
 * When a position is redeemed, the tokens are burned but CLOB still shows
 * the original buy/sell history.
 *
 * Correct formula:
 * PnL = (CLOB sells - CLOB buys) + Redemptions + Unrealized
 *
 * Where:
 * - CLOB sells/buys = historical trade cash flows
 * - Redemptions = actual cash received from resolved winning positions
 * - Unrealized = current value of positions NOT yet redeemed
 *
 * The tricky part: for each condition, we need to track whether it was
 * already redeemed (in which case the CLOB net tokens are now 0 in reality)
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

  console.log(`\n=== PNL V29 (CORRECT) FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Step 1: Get position-level data from CLOB
  const posResult = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'buy' THEN max_tokens ELSE 0 END) / 1e6 as tokens_bought,
        sum(CASE WHEN t.side = 'sell' THEN max_tokens ELSE 0 END) / 1e6 as tokens_sold,
        sum(CASE WHEN t.side = 'buy' THEN max_usdc ELSE 0 END) / 1e6 as cash_paid,
        sum(CASE WHEN t.side = 'sell' THEN max_usdc ELSE 0 END) / 1e6 as cash_received
      FROM (
        SELECT
          event_id,
          side,
          token_id,
          max(token_amount) as max_tokens,
          max(usdc_amount) as max_usdc
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        GROUP BY event_id, side, token_id
      ) t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      GROUP BY m.condition_id, m.outcome_index
    `,
    format: 'JSONEachRow',
  });

  const positions = await posResult.json() as any[];

  // Step 2: Get redemptions by condition
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        cid as condition_id,
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

  // Step 3: Get resolutions
  const conditionIds = [...new Set(positions.map((p: any) => p.condition_id.toLowerCase()))];
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

  // Step 4: Calculate PnL per position
  // For each position:
  // - Net cash = cash_received - cash_paid (from CLOB)
  // - If redeemed: no additional value (redemption already captured)
  // - If not redeemed but resolved: position value = tokens * resolution_price
  // - If unresolved: use mark price (or estimate)

  console.log(`\n=== POSITION BREAKDOWN ===`);
  console.log('cond_id              | idx | bought | sold  | net   | paid   | rcvd   | redeemed | res  | pnl');
  console.log('-'.repeat(115));

  let totalPnl = 0;

  // Group by condition to handle multi-outcome correctly
  const byCondition = new Map<string, any[]>();
  for (const pos of positions) {
    const key = pos.condition_id.toLowerCase();
    if (!byCondition.has(key)) byCondition.set(key, []);
    byCondition.get(key)!.push(pos);
  }

  for (const [conditionId, outcomes] of byCondition) {
    const redemption = redemptionByCondition.get(conditionId) ?? 0;
    const prices = resolutions.get(conditionId);
    const isResolved = prices !== undefined && prices.length > 0;

    // For this condition, calculate combined cash flow
    let conditionCashFlow = 0;
    let conditionPositionValue = 0;

    for (const pos of outcomes) {
      const netTokens = pos.tokens_bought - pos.tokens_sold;
      const netCash = pos.cash_received - pos.cash_paid;
      const resPrice = prices && prices.length > pos.outcome_index ? prices[pos.outcome_index] : 0;

      conditionCashFlow += netCash;

      // Position value: only count if NOT already redeemed
      // If redeemed, the cash is in redemption, not in position value
      if (redemption === 0 && netTokens > 0 && isResolved) {
        conditionPositionValue += netTokens * resPrice;
      }

      console.log(
        `${conditionId.substring(0, 20)}... | ${pos.outcome_index}   | ` +
        `${pos.tokens_bought.toFixed(1).padStart(6)} | ` +
        `${pos.tokens_sold.toFixed(1).padStart(5)} | ` +
        `${netTokens.toFixed(1).padStart(5)} | ` +
        `$${pos.cash_paid.toFixed(0).padStart(5)} | ` +
        `$${pos.cash_received.toFixed(0).padStart(5)} | ` +
        `$${(redemption > 0 ? redemption : 0).toFixed(0).padStart(7)} | ` +
        `${resPrice.toFixed(1).padStart(4)} | `
      );
    }

    const conditionPnl = conditionCashFlow + redemption + conditionPositionValue;
    totalPnl += conditionPnl;

    console.log(`  -> Condition PnL: $${conditionCashFlow.toFixed(2)} (cash) + $${redemption.toFixed(2)} (redemp) + $${conditionPositionValue.toFixed(2)} (pos) = $${conditionPnl.toFixed(2)}`);
    console.log('');
  }

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL:   $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

main().catch(console.error);
