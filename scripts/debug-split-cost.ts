/**
 * Debug Split Cost - The Correct PnL Formula
 *
 * Key insight: When you split, you pay $1 to get 1 token of EACH outcome.
 * If you then sell those tokens, your profit is:
 *   sale_proceeds - split_cost
 *
 * From CLOB data alone, we see:
 * - Sells without corresponding buys (tokens came from splits)
 * - The split cost is NOT in CLOB data
 *
 * How to infer split cost:
 * If net_tokens < 0 for both outcomes of a condition, splits happened.
 * The split amount = min(abs(O0_deficit), abs(O1_deficit))
 * Split cost = split_amount * $1
 *
 * For a condition with resolution:
 * - O0 resolves to 1.0, O1 resolves to 0.0 (or vice versa)
 * - If you have +X O0 tokens, you get $X
 * - If you have -Y O0 tokens from split and sold them, you got sale proceeds
 *   but the split cost = Y * $1, and you no longer have tokens to redeem
 *
 * The formula should be:
 * PnL = net_cash_from_trades + tokens_held * resolution_price - split_cost
 *
 * Where split_cost = amount of tokens that came from splits (not buys)
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

async function analyze(wallet: string) {
  console.log(`\n=== SPLIT COST ANALYSIS FOR ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  interface Position {
    bought: number;
    sold: number;
    cashPaid: number;
    cashReceived: number;
  }

  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const posKey = `${trade.condition_id}_${trade.outcome_index}`;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = { bought: 0, sold: 0, cashPaid: 0, cashReceived: 0 };
      positions.set(posKey, pos);
    }

    if (trade.side === 'buy') {
      pos.bought += trade.tokens;
      pos.cashPaid += trade.usdc;
    } else {
      pos.sold += trade.tokens;
      pos.cashReceived += trade.usdc;
    }
  }

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

  // Group by condition
  const byCondition = new Map<string, { o0: Position | null; o1: Position | null }>();
  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);

    if (!byCondition.has(conditionId)) {
      byCondition.set(conditionId, { o0: null, o1: null });
    }
    const entry = byCondition.get(conditionId)!;
    if (outcomeIndex === 0) entry.o0 = pos;
    else if (outcomeIndex === 1) entry.o1 = pos;
  }

  console.log(`\n=== PER-CONDITION BREAKDOWN ===`);
  console.log('For each condition:');
  console.log('  - deficit = bought - sold (negative means split-derived tokens sold)');
  console.log('  - split_amount = min(abs(O0_deficit), abs(O1_deficit)) when both negative');
  console.log('');

  let totalPnl = 0;
  let totalSplitCost = 0;

  for (const [conditionId, { o0, o1 }] of byCondition) {
    const prices = resolutions.get(conditionId);
    const p0 = prices && prices.length > 0 ? prices[0] : 0;
    const p1 = prices && prices.length > 1 ? prices[1] : 0;
    const resolved = prices !== undefined;

    const o0Bought = o0?.bought ?? 0;
    const o0Sold = o0?.sold ?? 0;
    const o1Bought = o1?.bought ?? 0;
    const o1Sold = o1?.sold ?? 0;

    const o0Net = o0Bought - o0Sold;  // positive = net long, negative = sold more than bought
    const o1Net = o1Bought - o1Sold;

    const o0CashNet = (o0?.cashReceived ?? 0) - (o0?.cashPaid ?? 0);
    const o1CashNet = (o1?.cashReceived ?? 0) - (o1?.cashPaid ?? 0);
    const totalCashNet = o0CashNet + o1CashNet;

    // Infer split amount: if both deficits are negative, splits happened
    let inferredSplitAmount = 0;
    if (o0Net < 0 && o1Net < 0) {
      // Both outcomes have more sold than bought
      // The split amount = min of the two deficits
      inferredSplitAmount = Math.min(Math.abs(o0Net), Math.abs(o1Net));
    } else if (o0Net < 0 || o1Net < 0) {
      // Only one side has deficit - this is the split amount
      inferredSplitAmount = Math.max(Math.abs(Math.min(0, o0Net)), Math.abs(Math.min(0, o1Net)));
    }

    const splitCost = inferredSplitAmount;  // $1 per split

    // Token values at resolution
    // If net > 0, you hold tokens worth net * resolution_price
    // If net < 0, you're short and owe net * resolution_price
    // But if those tokens came from splits, you already paid for them via splitCost

    // Actually, let's think about it differently:
    // Final tokens held = bought - sold + split_tokens
    // If bought = 100, sold = 150, then net = -50, meaning 50 came from splits
    // So final_held = 100 - 150 + 50 = 0 (no tokens held, all sold)

    // For split: you pay $1 to get 1 of each. So:
    // - O0 tokens from split = splitAmount
    // - O1 tokens from split = splitAmount

    // Actual tokens held after all trades + splits:
    // O0: bought - sold + splitAmount
    // O1: bought - sold + splitAmount

    const o0Held = o0Bought - o0Sold + inferredSplitAmount;
    const o1Held = o1Bought - o1Sold + inferredSplitAmount;

    const positionValue = o0Held * p0 + o1Held * p1;

    // PnL = cash from trades - split cost + position value
    const conditionPnl = totalCashNet - splitCost + positionValue;

    if (Math.abs(conditionPnl) > 0.1 || inferredSplitAmount > 0 || Math.abs(o0Net) > 1 || Math.abs(o1Net) > 1) {
      console.log(`${conditionId.substring(0, 16)}...`);
      console.log(`  O0: bought=${o0Bought.toFixed(1)}, sold=${o0Sold.toFixed(1)}, net=${o0Net.toFixed(1)}, held=${o0Held.toFixed(1)} @${p0}`);
      console.log(`  O1: bought=${o1Bought.toFixed(1)}, sold=${o1Sold.toFixed(1)}, net=${o1Net.toFixed(1)}, held=${o1Held.toFixed(1)} @${p1}`);
      console.log(`  Cash: ${totalCashNet.toFixed(2)}, Split: ${inferredSplitAmount.toFixed(1)} ($${splitCost.toFixed(2)})`);
      console.log(`  Position value: $${positionValue.toFixed(2)}`);
      console.log(`  PnL: ${totalCashNet.toFixed(2)} - ${splitCost.toFixed(2)} + ${positionValue.toFixed(2)} = $${conditionPnl.toFixed(2)}`);
      console.log('');
    }

    totalPnl += conditionPnl;
    totalSplitCost += splitCost;
  }

  console.log(`=== SUMMARY ===`);
  console.log(`Total split cost: $${totalSplitCost.toFixed(2)}`);
  console.log(`Total PnL (split-adjusted): $${totalPnl.toFixed(2)}`);
  console.log(`API PnL:                    $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference:                 $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
analyze(wallet).catch(console.error);
