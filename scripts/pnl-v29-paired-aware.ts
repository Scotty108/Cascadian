/**
 * PnL V29 - Paired Trade Aware
 *
 * KEY INSIGHT: When O0 price + O1 price = 1.0, this is a Neg Risk Adapter trade.
 * The CLOB shows cash flowing, but actually:
 * - SPLIT: You pay $1 to Neg Risk Adapter, get 1 token of EACH outcome
 * - MERGE: You return 1 token of each outcome, get $1 back
 *
 * The CLOB data "fakes" the cash flow for accounting purposes, but we shouldn't
 * count it in our PnL calculation.
 *
 * Correct approach:
 * 1. Identify paired trades where prices sum to ~1.0
 * 2. For these trades:
 *    - SPLIT: cost = tokens (you paid $1 per token pair)
 *    - MERGE: revenue = tokens (you got $1 per token pair)
 * 3. For unpaired trades: use actual USDC amounts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

interface Trade {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  price: number;
  tokens: number;
  usdc: number;
  ts: number;
}

async function getTrades(wallet: string): Promise<Trade[]> {
  const w = wallet.toLowerCase();

  const query = `
    SELECT
      substring(t.event_id, 1, 66) as tx_hash,
      m.condition_id,
      m.outcome_index,
      t.side,
      max(t.usdc_amount) / max(t.token_amount) as price,
      max(t.token_amount) / 1000000.0 as tokens,
      max(t.usdc_amount) / 1000000.0 as usdc,
      max(toUnixTimestamp(t.trade_time)) as ts
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    ORDER BY ts ASC, tx_hash ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => ({
    tx_hash: r.tx_hash,
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    side: r.side.toLowerCase(),
    price: Number(r.price),
    tokens: Number(r.tokens),
    usdc: Number(r.usdc),
    ts: Number(r.ts),
  }));
}

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

  console.log(`\n=== PNL V29 (PAIRED TRADE AWARE) FOR ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Group trades by (ts, condition_id)
  const byTsCondition = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = `${trade.ts}_${trade.condition_id}`;
    if (!byTsCondition.has(key)) {
      byTsCondition.set(key, []);
    }
    byTsCondition.get(key)!.push(trade);
  }

  // Identify paired trades and compute adjusted cash flows
  interface Position {
    tokens: number;
    cash: number;  // adjusted cash (real USDC flow only)
  }

  const positions = new Map<string, Position>();
  let totalSplitCost = 0;
  let totalMergeRevenue = 0;
  let pairedTradeCount = 0;
  let unpairedTradeCount = 0;

  for (const [key, group] of byTsCondition) {
    const conditionId = key.split('_')[1];
    const o0Trades = group.filter(t => t.outcome_index === 0);
    const o1Trades = group.filter(t => t.outcome_index === 1);

    // Check if this is a paired trade (both outcomes at same timestamp)
    if (o0Trades.length > 0 && o1Trades.length > 0) {
      const o0 = o0Trades[0];
      const o1 = o1Trades[0];

      // Check if prices sum to ~1.0 (neg risk adapter pattern)
      const priceSum = o0.price + o1.price;
      const isNegRisk = Math.abs(priceSum - 1.0) < 0.01;

      if (isNegRisk) {
        pairedTradeCount++;

        // SPLIT: sell O0 + buy O1 -> you paid $tokens for the pair
        // MERGE: buy O0 + sell O1 -> you got $tokens back for the pair

        if (o0.side === 'sell' && o1.side === 'buy') {
          // SPLIT: pay $1 per token pair
          totalSplitCost += o0.tokens;  // token amount = USDC paid

          // Token accounting: you get tokens from the split
          let pos0 = positions.get(`${conditionId}_0`);
          if (!pos0) { pos0 = { tokens: 0, cash: 0 }; positions.set(`${conditionId}_0`, pos0); }
          pos0.tokens += o0.tokens;  // you RECEIVE tokens from split (not sell)
          pos0.cash -= o0.tokens;  // you PAY for them

          let pos1 = positions.get(`${conditionId}_1`);
          if (!pos1) { pos1 = { tokens: 0, cash: 0 }; positions.set(`${conditionId}_1`, pos1); }
          pos1.tokens += o1.tokens;  // you RECEIVE tokens from split

        } else if (o0.side === 'buy' && o1.side === 'sell') {
          // MERGE: get $1 per token pair
          totalMergeRevenue += o0.tokens;  // token amount = USDC received

          // Token accounting: you give up tokens in the merge
          let pos0 = positions.get(`${conditionId}_0`);
          if (!pos0) { pos0 = { tokens: 0, cash: 0 }; positions.set(`${conditionId}_0`, pos0); }
          pos0.tokens -= o0.tokens;  // you GIVE UP tokens in merge

          let pos1 = positions.get(`${conditionId}_1`);
          if (!pos1) { pos1 = { tokens: 0, cash: 0 }; positions.set(`${conditionId}_1`, pos1); }
          pos1.tokens -= o1.tokens;  // you GIVE UP tokens in merge
          pos1.cash += o1.tokens;  // you GET paid (tokens = $1 per pair)
        }

        continue;  // Skip normal processing for paired trades
      }
    }

    // Unpaired or non-neg-risk trades: use actual cash flow
    for (const trade of group) {
      unpairedTradeCount++;
      const posKey = `${trade.condition_id}_${trade.outcome_index}`;

      let pos = positions.get(posKey);
      if (!pos) {
        pos = { tokens: 0, cash: 0 };
        positions.set(posKey, pos);
      }

      if (trade.side === 'buy') {
        pos.tokens += trade.tokens;
        pos.cash -= trade.usdc;
      } else {
        pos.tokens -= trade.tokens;
        pos.cash += trade.usdc;
      }
    }
  }

  console.log(`\nPaired (neg risk) trades: ${pairedTradeCount}`);
  console.log(`Unpaired trades: ${unpairedTradeCount}`);
  console.log(`Total split cost: $${totalSplitCost.toFixed(2)}`);
  console.log(`Total merge revenue: $${totalMergeRevenue.toFixed(2)}`);

  // Get resolutions
  const conditionIds = Array.from(new Set(Array.from(positions.keys()).map(k => k.split('_')[0])));
  const idList = conditionIds.map(id => `'${id}'`).join(',');

  let resolutions = new Map<string, number[]>();
  if (conditionIds.length > 0) {
    const query = `
      SELECT lower(condition_id) as condition_id, norm_prices
      FROM pm_condition_resolutions_norm
      WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
    `;
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { condition_id: string; norm_prices: number[] }[];
    for (const row of rows) {
      resolutions.set(row.condition_id, row.norm_prices);
    }
  }

  // Calculate PnL
  let totalCash = 0;
  let totalPositionValue = 0;

  console.log(`\n=== POSITION BREAKDOWN ===`);
  console.log('condition_id         | idx | tokens  | cash     | res_price | value');
  console.log('-'.repeat(80));

  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);
    const prices = resolutions.get(conditionId);
    const resPrice = prices && prices.length > outcomeIndex ? prices[outcomeIndex] : 0;

    const posValue = pos.tokens * resPrice;
    totalCash += pos.cash;
    totalPositionValue += posValue;

    if (Math.abs(pos.tokens) > 0.1 || Math.abs(pos.cash) > 1) {
      console.log(
        `${conditionId.substring(0, 20)}... | ${outcomeIndex}   | ` +
        `${pos.tokens.toFixed(1).padStart(7)} | ` +
        `$${pos.cash.toFixed(2).padStart(7)} | ` +
        `${resPrice.toFixed(2).padStart(9)} | ` +
        `$${posValue.toFixed(2).padStart(7)}`
      );
    }
  }

  const totalPnl = totalCash + totalPositionValue;

  console.log(`\n=== FINAL PNL ===`);
  console.log(`Total cash flow: $${totalCash.toFixed(2)}`);
  console.log(`Position value:  $${totalPositionValue.toFixed(2)}`);
  console.log(`Total PnL:       $${totalPnl.toFixed(2)}`);
  console.log(`API PnL:         $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference:      $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

main().catch(console.error);
