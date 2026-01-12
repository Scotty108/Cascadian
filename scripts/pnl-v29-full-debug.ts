/**
 * PnL V29 - Full Debug
 * Show ALL conditions including small ones to find the $5.42 discrepancy
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

  console.log(`\n=== PNL V29 - FULL DEBUG FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get all trades with proper deduplication
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        sum(max_tokens) as total_tokens,
        sum(max_usdc) as total_usdc
      FROM (
        SELECT
          event_id,
          side,
          token_id,
          max(token_amount) / 1e6 as max_tokens,
          max(usdc_amount) / 1e6 as max_usdc
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        GROUP BY event_id, side, token_id
      ) t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NOT NULL
      GROUP BY m.condition_id, m.outcome_index, t.side
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  // Build condition data
  interface ConditionData {
    o0Buys: number;
    o0Sells: number;
    o0BuyUSDC: number;
    o0SellUSDC: number;
    o1Buys: number;
    o1Sells: number;
    o1BuyUSDC: number;
    o1SellUSDC: number;
  }

  const conditions = new Map<string, ConditionData>();

  for (const row of rows) {
    let c = conditions.get(row.condition_id);
    if (!c) {
      c = {
        o0Buys: 0, o0Sells: 0, o0BuyUSDC: 0, o0SellUSDC: 0,
        o1Buys: 0, o1Sells: 0, o1BuyUSDC: 0, o1SellUSDC: 0,
      };
      conditions.set(row.condition_id, c);
    }

    if (row.outcome_index === 0) {
      if (row.side === 'buy') {
        c.o0Buys = row.total_tokens;
        c.o0BuyUSDC = row.total_usdc;
      } else {
        c.o0Sells = row.total_tokens;
        c.o0SellUSDC = row.total_usdc;
      }
    } else {
      if (row.side === 'buy') {
        c.o1Buys = row.total_tokens;
        c.o1BuyUSDC = row.total_usdc;
      } else {
        c.o1Sells = row.total_tokens;
        c.o1SellUSDC = row.total_usdc;
      }
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

  // Calculate PnL per condition
  console.log(`\n=== ALL CONDITIONS ===`);
  console.log('condition                 | net O0 | net O1 | cash   | liab   | posVal | redemp | PnL');
  console.log('-'.repeat(105));

  let totalPnl = 0;
  const pnlByCondition: { cid: string; pnl: number }[] = [];

  for (const [conditionId, c] of conditions) {
    const netO0 = c.o0Buys - c.o0Sells;
    const netO1 = c.o1Buys - c.o1Sells;
    const cashFlow = (c.o0SellUSDC - c.o0BuyUSDC) + (c.o1SellUSDC - c.o1BuyUSDC);

    const prices = resolutions.get(conditionId);
    const redemption = redemptionByCondition.get(conditionId) ?? 0;

    // Calculate liability for negative positions
    let liability = 0;
    if (prices && netO0 < -0.01) {
      liability += Math.abs(netO0) * prices[0];
    }
    if (prices && netO1 < -0.01) {
      liability += Math.abs(netO1) * prices[1];
    }

    // Calculate position value for positive positions
    let positionValue = 0;
    if (prices) {
      const totalPosValue = (netO0 > 0.01 ? netO0 * prices[0] : 0) + (netO1 > 0.01 ? netO1 * prices[1] : 0);
      const unredeemedValue = Math.max(0, totalPosValue - redemption);
      positionValue = unredeemedValue;
    }

    const conditionPnl = cashFlow - liability + redemption + positionValue;

    totalPnl += conditionPnl;
    pnlByCondition.push({ cid: conditionId, pnl: conditionPnl });

    // Show all conditions
    const resolved = prices ? `[${prices.join(',')}]` : 'unres';
    console.log(
      `${conditionId.substring(0, 24)}... | ` +
      `${netO0.toFixed(1).padStart(6)} | ` +
      `${netO1.toFixed(1).padStart(6)} | ` +
      `$${cashFlow.toFixed(2).padStart(5)} | ` +
      `$${liability.toFixed(2).padStart(5)} | ` +
      `$${positionValue.toFixed(2).padStart(5)} | ` +
      `$${redemption.toFixed(2).padStart(5)} | ` +
      `$${conditionPnl.toFixed(2)} ${resolved}`
    );
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total conditions: ${conditions.size}`);
  console.log(`Calculated PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // Check for unresolved positions
  const unresolvedCount = conditionIds.filter(id => !resolutions.has(id)).length;
  console.log(`\nUnresolved conditions: ${unresolvedCount}`);

  // Sum of unredeemed winning positions
  let totalUnredeemed = 0;
  for (const [conditionId, c] of conditions) {
    const prices = resolutions.get(conditionId);
    const redemption = redemptionByCondition.get(conditionId) ?? 0;
    const netO0 = c.o0Buys - c.o0Sells;
    const netO1 = c.o1Buys - c.o1Sells;

    if (prices) {
      const totalPosValue = (netO0 > 0.01 ? netO0 * prices[0] : 0) + (netO1 > 0.01 ? netO1 * prices[1] : 0);
      const unredeemed = Math.max(0, totalPosValue - redemption);
      totalUnredeemed += unredeemed;
    }
  }
  console.log(`Total unredeemed position value: $${totalUnredeemed.toFixed(2)}`);

  process.exit(0);
}

main().catch(console.error);
