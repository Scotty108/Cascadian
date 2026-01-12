/**
 * PnL V29 - Find Unredeemed Positions
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

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

  const trades = await result.json() as any[];

  // Build positions
  const positions = new Map<string, { tokens: number; cash: number }>();
  for (const trade of trades) {
    const key = `${trade.condition_id}_${trade.outcome_index}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { tokens: 0, cash: 0 };
      positions.set(key, pos);
    }

    const tokenDelta = trade.side === 'buy' ? trade.tokens : -trade.tokens;
    const cashDelta = trade.side === 'buy' ? -trade.usdc : trade.usdc;

    pos.tokens += tokenDelta;
    pos.cash += cashDelta;
  }

  // Group by condition
  interface ConditionData { o0: number; o1: number; o0Cash: number; o1Cash: number; }
  const byCondition = new Map<string, ConditionData>();
  for (const [key, pos] of positions) {
    const parts = key.split('_');
    const cid = parts[0];
    const oi = parseInt(parts[1]);
    if (!byCondition.has(cid)) {
      byCondition.set(cid, { o0: 0, o1: 0, o0Cash: 0, o1Cash: 0 });
    }
    const c = byCondition.get(cid)!;
    if (oi === 0) {
      c.o0 = pos.tokens;
      c.o0Cash = pos.cash;
    } else {
      c.o1 = pos.tokens;
      c.o1Cash = pos.cash;
    }
  }

  // Get resolutions
  const conditionIds = Array.from(byCondition.keys());
  const idList = conditionIds.map(id => `'${id}'`).join(',');

  const resolutions = new Map<string, number[]>();
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

  // Find resolved positions with value that weren't redeemed
  console.log('=== UNREDEEMED POSITIONS WITH VALUE ===');
  console.log('condition                 | O0 tok | O1 tok | res    | unredeemed value');
  console.log('-'.repeat(80));

  let totalUnredeemedValue = 0;

  for (const [cid, c] of byCondition) {
    const prices = resolutions.get(cid);
    const redemption = redemptionByCondition.get(cid) ?? 0;

    if (!prices) continue;  // Not resolved
    if (redemption > 0) continue;  // Already redeemed

    // Calculate position value
    let posValue = 0;
    if (c.o0 > 0.01) posValue += c.o0 * prices[0];
    if (c.o1 > 0.01) posValue += c.o1 * prices[1];

    if (posValue > 0.1) {
      console.log(
        `${cid.substring(0, 24)}... | ` +
        `${c.o0.toFixed(1).padStart(6)} | ` +
        `${c.o1.toFixed(1).padStart(6)} | ` +
        `[${prices.join(',')}] | ` +
        `$${posValue.toFixed(2)}`
      );
      totalUnredeemedValue += posValue;
    }
  }

  console.log(`\nTotal unredeemed value: $${totalUnredeemedValue.toFixed(2)}`);
  console.log(`Remaining discrepancy: $97.91`);
  console.log(`Difference: $${(totalUnredeemedValue - 97.91).toFixed(2)}`);

  // So the formula should be:
  // PnL = cash_flow - split_cost + redemptions - unredeemed_value_that_should_not_count
  // Wait, that doesn't make sense. Let me think again...

  // Let's verify the actual formula we're using
  console.log('\n=== RECALCULATING WITH PROPER FORMULA ===');

  let totalCash = 0;
  let totalSplitCost = 0;
  let totalRedemptions = 0;
  let totalPositionValue = 0;

  for (const [cid, c] of byCondition) {
    const cash = c.o0Cash + c.o1Cash;
    const prices = resolutions.get(cid);
    const redemption = redemptionByCondition.get(cid) ?? 0;

    totalCash += cash;
    totalRedemptions += redemption;

    // Split cost: if BOTH negative, user split tokens
    if (c.o0 < -0.01 && c.o1 < -0.01) {
      totalSplitCost += Math.min(Math.abs(c.o0), Math.abs(c.o1));
    }

    // Position value for positive tokens (only if not redeemed)
    if (redemption === 0 && prices) {
      if (c.o0 > 0.01) totalPositionValue += c.o0 * prices[0];
      if (c.o1 > 0.01) totalPositionValue += c.o1 * prices[1];
    }
  }

  console.log(`Cash flow: $${totalCash.toFixed(2)}`);
  console.log(`Split cost: $${totalSplitCost.toFixed(2)}`);
  console.log(`Redemptions: $${totalRedemptions.toFixed(2)}`);
  console.log(`Position value (unredeemed): $${totalPositionValue.toFixed(2)}`);

  // Option 1: Include position value
  const pnl1 = totalCash - totalSplitCost + totalRedemptions + totalPositionValue;
  console.log(`\nPnL (incl position value): $${pnl1.toFixed(2)}`);

  // Option 2: Exclude position value
  const pnl2 = totalCash - totalSplitCost + totalRedemptions;
  console.log(`PnL (excl position value): $${pnl2.toFixed(2)}`);

  // Option 3: What if unredeemed position value is NOT counted?
  // The API might only count realized PnL (cash + redemptions - costs)
  const pnl3 = totalCash - totalSplitCost + totalRedemptions - totalPositionValue;
  console.log(`PnL (minus position value): $${pnl3.toFixed(2)}`);

  console.log(`\nAPI PnL: $215.85`);

  process.exit(0);
}

main().catch(console.error);
