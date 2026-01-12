/**
 * PnL V29 - Neg Risk Aware
 *
 * KEY INSIGHT: When trades happen at complementary prices (O0 + O1 ≈ 1.0),
 * these are Neg Risk Adapter trades. The USDC amounts shown in CLOB are
 * NOT real cash flows - they're internal accounting.
 *
 * For Neg Risk trades:
 * - "Sell O0 @ 0.64 + Buy O1 @ 0.36" = position swap, NOT real cash
 * - The only real cost is slippage (deviation from 1.0 total)
 *
 * Correct approach:
 * 1. Group trades by timestamp + condition
 * 2. If both outcomes trade at prices summing to ~1.0, it's Neg Risk
 * 3. For Neg Risk trades: only count the SPREAD as real cash
 * 4. For regular trades: count full USDC amount
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

  console.log(`\n=== PNL V29 (NEG RISK AWARE) FOR ${wallet} ===\n`);

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

  // Process trades, separating Neg Risk from regular
  interface Position {
    tokens: number;
    realCash: number;  // only real cash flows
  }

  const positions = new Map<string, Position>();
  let negRiskTradeCount = 0;
  let regularTradeCount = 0;
  let totalFakeCash = 0;
  let totalRealCash = 0;

  for (const [key, group] of byTimeCondition) {
    const conditionId = key.split('_').slice(1).join('_');
    const o0Trades = group.filter(t => t.outcome_index === 0);
    const o1Trades = group.filter(t => t.outcome_index === 1);

    // Check for Neg Risk pattern: both outcomes at complementary prices
    if (o0Trades.length > 0 && o1Trades.length > 0) {
      const o0 = o0Trades[0];
      const o1 = o1Trades[0];
      const priceSum = o0.price + o1.price;

      if (Math.abs(priceSum - 1.0) < 0.02) {
        // This is a Neg Risk trade!
        negRiskTradeCount++;

        // The USDC amounts are fake - calculate real spread cost
        // For "sell O0 + buy O1": you receive O0_usdc, pay O1_usdc
        // But this is internal - the real cost is just slippage

        // Actually, for position tracking, we still need to track tokens
        // but the CASH is fake
        const o0Key = `${conditionId}_0`;
        const o1Key = `${conditionId}_1`;

        let pos0 = positions.get(o0Key);
        if (!pos0) { pos0 = { tokens: 0, realCash: 0 }; positions.set(o0Key, pos0); }
        let pos1 = positions.get(o1Key);
        if (!pos1) { pos1 = { tokens: 0, realCash: 0 }; positions.set(o1Key, pos1); }

        // Token flow is real (position changes)
        if (o0.side === 'sell') pos0.tokens -= o0.tokens;
        else pos0.tokens += o0.tokens;
        if (o1.side === 'buy') pos1.tokens += o1.tokens;
        else pos1.tokens -= o1.tokens;

        // Cash flow is FAKE - don't count it
        const fakeCash = (o0.side === 'sell' ? o0.usdc : -o0.usdc) +
                         (o1.side === 'sell' ? o1.usdc : -o1.usdc);
        totalFakeCash += fakeCash;

        continue;
      }
    }

    // Regular trades - count full cash flow
    for (const trade of group) {
      regularTradeCount++;
      const posKey = `${trade.condition_id}_${trade.outcome_index}`;

      let pos = positions.get(posKey);
      if (!pos) { pos = { tokens: 0, realCash: 0 }; positions.set(posKey, pos); }

      if (trade.side === 'buy') {
        pos.tokens += trade.tokens;
        pos.realCash -= trade.usdc;
        totalRealCash -= trade.usdc;
      } else {
        pos.tokens -= trade.tokens;
        pos.realCash += trade.usdc;
        totalRealCash += trade.usdc;
      }
    }
  }

  console.log(`\nNeg Risk trades (ignored cash): ${negRiskTradeCount}`);
  console.log(`Regular trades (real cash): ${regularTradeCount}`);
  console.log(`Total fake cash from Neg Risk: $${totalFakeCash.toFixed(2)}`);
  console.log(`Total real cash from regular: $${totalRealCash.toFixed(2)}`);

  // Get redemptions
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
  let totalRedemptions = 0;
  for (const r of redemptions) {
    redemptionByCondition.set(r.condition_id, r.payout_amount);
    totalRedemptions += r.payout_amount;
  }

  console.log(`Total redemptions: $${totalRedemptions.toFixed(2)}`);

  // Get resolutions
  const conditionIds = [...new Set(Array.from(positions.keys()).map(k => k.split('_')[0]))];
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

  // Calculate PnL per condition
  const byCondition = new Map<string, { positions: Map<number, Position>; redemption: number }>();

  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);

    if (!byCondition.has(conditionId)) {
      byCondition.set(conditionId, {
        positions: new Map(),
        redemption: redemptionByCondition.get(conditionId) ?? 0
      });
    }

    byCondition.get(conditionId)!.positions.set(outcomeIndex, pos);
  }

  console.log(`\n=== PNL BY CONDITION ===`);

  let totalPnl = 0;

  for (const [conditionId, data] of byCondition) {
    const prices = resolutions.get(conditionId);
    const isResolved = prices !== undefined;

    let conditionCash = 0;
    let conditionPositionValue = 0;

    for (const [outcomeIndex, pos] of data.positions) {
      conditionCash += pos.realCash;

      // Position value only if NOT redeemed
      if (data.redemption === 0 && pos.tokens > 0 && isResolved) {
        const resPrice = prices![outcomeIndex] ?? 0;
        conditionPositionValue += pos.tokens * resPrice;
      }
    }

    const conditionPnl = conditionCash + data.redemption + conditionPositionValue;

    if (Math.abs(conditionPnl) > 1 || data.redemption > 0) {
      console.log(
        `${conditionId.substring(0, 16)}... | ` +
        `Cash: $${conditionCash.toFixed(2).padStart(7)} | ` +
        `Redemp: $${data.redemption.toFixed(2).padStart(6)} | ` +
        `Pos: $${conditionPositionValue.toFixed(2).padStart(6)} | ` +
        `PnL: $${conditionPnl.toFixed(2)}`
      );
    }

    totalPnl += conditionPnl;
  }

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL:   $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference: $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

main().catch(console.error);
