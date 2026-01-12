/**
 * Debug Paired Trades - Identify Neg Risk Adapter Pattern
 *
 * Detects simultaneous opposite-side trades on both outcomes
 * which are actually split/merge operations through CLOB
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

interface PairedTrade {
  ts: number;
  condition_id: string;
  o0_side: string;
  o1_side: string;
  o0_tokens: number;
  o1_tokens: number;
  o0_usdc: number;
  o1_usdc: number;
  net_usdc: number;  // negative = cash out, positive = cash in
  type: 'SPLIT' | 'MERGE' | 'OTHER';
}

async function analyze(wallet: string) {
  console.log(`\n=== ANALYZING PAIRED TRADES FOR ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Group trades by (ts, condition_id) to find paired trades
  const groupedByTsCondition = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = `${trade.ts}_${trade.condition_id}`;
    if (!groupedByTsCondition.has(key)) {
      groupedByTsCondition.set(key, []);
    }
    groupedByTsCondition.get(key)!.push(trade);
  }

  // Identify paired trades (trades with both outcome 0 and 1 at same timestamp)
  const pairedTrades: PairedTrade[] = [];
  const unpaired: Trade[] = [];

  for (const [key, group] of groupedByTsCondition) {
    const o0Trades = group.filter(t => t.outcome_index === 0);
    const o1Trades = group.filter(t => t.outcome_index === 1);

    if (o0Trades.length > 0 && o1Trades.length > 0) {
      // This is a paired trade!
      for (const o0 of o0Trades) {
        for (const o1 of o1Trades) {
          // Check if they're opposite sides (SPLIT or MERGE pattern)
          let type: 'SPLIT' | 'MERGE' | 'OTHER' = 'OTHER';
          let netUsdc = 0;

          if (o0.side === 'sell' && o1.side === 'buy') {
            // SPLIT: sell O0 + buy O1 = net cash out
            type = 'SPLIT';
            netUsdc = o0.usdc - o1.usdc;  // get cash from selling O0, spend on O1
          } else if (o0.side === 'buy' && o1.side === 'sell') {
            // MERGE: buy O0 + sell O1 = net cash in
            type = 'MERGE';
            netUsdc = o1.usdc - o0.usdc;  // get cash from selling O1, spend on O0
          }

          pairedTrades.push({
            ts: o0.ts,
            condition_id: o0.condition_id,
            o0_side: o0.side,
            o1_side: o1.side,
            o0_tokens: o0.tokens,
            o1_tokens: o1.tokens,
            o0_usdc: o0.usdc,
            o1_usdc: o1.usdc,
            net_usdc: netUsdc,
            type,
          });
        }
      }
    } else {
      unpaired.push(...group);
    }
  }

  console.log(`\n=== PAIRED TRADES ANALYSIS ===`);
  console.log(`Paired trade groups: ${pairedTrades.length}`);
  console.log(`Unpaired trades: ${unpaired.length}`);

  // Analyze paired trades
  const splits = pairedTrades.filter(p => p.type === 'SPLIT');
  const merges = pairedTrades.filter(p => p.type === 'MERGE');

  console.log(`\nSPLIT operations: ${splits.length}`);
  console.log(`MERGE operations: ${merges.length}`);

  // Calculate net USDC from splits/merges
  const totalSplitNet = splits.reduce((sum, p) => sum + p.net_usdc, 0);
  const totalMergeNet = merges.reduce((sum, p) => sum + p.net_usdc, 0);

  console.log(`\nSPLIT net USDC: $${totalSplitNet.toFixed(2)} (should be ~0 for pure splits)`);
  console.log(`MERGE net USDC: $${totalMergeNet.toFixed(2)} (should be ~0 for pure merges)`);
  console.log(`Combined net:   $${(totalSplitNet + totalMergeNet).toFixed(2)}`);

  // Show first few paired trades
  console.log(`\n=== SAMPLE PAIRED TRADES ===`);
  console.log('time       | type  | O0 side | O1 side | O0 usdc | O1 usdc | net usdc');
  console.log('-'.repeat(80));

  for (const p of pairedTrades.slice(0, 15)) {
    const time = new Date(p.ts * 1000).toISOString().substring(11, 19);
    console.log(
      `${time} | ${p.type.padEnd(5)} | ` +
      `${p.o0_side.padEnd(7)} | ${p.o1_side.padEnd(7)} | ` +
      `$${p.o0_usdc.toFixed(2).padStart(7)} | $${p.o1_usdc.toFixed(2).padStart(7)} | ` +
      `$${p.net_usdc.toFixed(2).padStart(7)}`
    );
  }

  // Now calculate PnL WITHOUT paired trades
  console.log(`\n=== RECALCULATING PNL WITHOUT PAIRED TRADES ===`);

  // Build positions from unpaired trades only
  interface Position {
    amount: number;
    avgPrice: number;
    realizedPnl: number;
    totalCost: number;
  }

  const positions = new Map<string, Position>();

  for (const trade of unpaired) {
    const posKey = `${trade.condition_id}_${trade.outcome_index}`;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = { amount: 0, avgPrice: 0, realizedPnl: 0, totalCost: 0 };
      positions.set(posKey, pos);
    }

    if (trade.side === 'buy') {
      const newAmount = pos.amount + trade.tokens;
      if (newAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + trade.price * trade.tokens) / newAmount;
        pos.totalCost += trade.usdc;
      }
      pos.amount = newAmount;
    } else {
      const adjustedSell = Math.min(trade.tokens, pos.amount);
      if (adjustedSell > 0) {
        const pnl = adjustedSell * (trade.price - pos.avgPrice);
        pos.realizedPnl += pnl;
        pos.amount -= adjustedSell;
      }
    }
  }

  // Get resolutions for remaining positions
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

  // Calculate total PnL from unpaired trades
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;

  for (const [posKey, pos] of positions) {
    totalRealizedPnl += pos.realizedPnl;

    if (pos.amount > 0.001) {
      const [conditionId, outcomeIndexStr] = posKey.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const costBasis = pos.amount * pos.avgPrice;

      const prices = resolutions.get(conditionId);
      if (prices && prices.length > outcomeIndex) {
        const resPrice = prices[outcomeIndex];
        totalUnrealizedPnl += pos.amount * resPrice - costBasis;
      } else {
        // Unresolved - assume 0.5 or use mark price
        totalUnrealizedPnl += pos.amount * 0.5 - costBasis;
      }
    }
  }

  const unpairedTotal = totalRealizedPnl + totalUnrealizedPnl;

  console.log(`\nUnpaired trades only:`);
  console.log(`  Realized PnL:   $${totalRealizedPnl.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${totalUnrealizedPnl.toFixed(2)}`);
  console.log(`  Total:          $${unpairedTotal.toFixed(2)}`);
  console.log(`  API Total:      $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`  Difference:     $${apiPnl !== null ? (unpairedTotal - apiPnl).toFixed(2) : 'N/A'}`);

  // The key insight: what if we track the USDC flow from paired trades as cost basis?
  // When you do a SPLIT: you're paying USDC to get tokens
  // When you do a MERGE: you're getting USDC back from tokens

  // Actually, let's see if the API might be accounting for spreads in paired trades
  const spreadCost = splits.reduce((sum, p) => {
    // In a perfect split, O0 price + O1 price = 1
    // Any deviation is spread/fee
    return sum + p.o0_usdc + p.o1_usdc - p.o0_tokens; // should be ~0 for pure split
  }, 0);

  console.log(`\n=== SPREAD ANALYSIS ===`);
  console.log(`Total spread/slippage in paired trades: $${spreadCost.toFixed(2)}`);

  process.exit(0);
}

const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
analyze(wallet).catch(console.error);
