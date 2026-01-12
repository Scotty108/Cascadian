/**
 * Debug Cashflow V2 - Correct handling for split-derived tokens
 *
 * Key insight: When wallet has NEGATIVE net tokens, it means they
 * obtained tokens from splits (not CLOB buys) and then sold them.
 *
 * For PnL calculation:
 * - Positive tokens: PnL = tokens * resolution_price - cost_basis
 * - Negative tokens: These came from splits!
 *   - The split cost = tokens * 1.0 (you pay $1 for full set of outcomes)
 *   - But you only see the SELL in CLOB data
 *   - So the "profit" on negative positions = cash_received (not -tokens*resPrice)
 *
 * Correct formula:
 * PnL = net_cash_flow + min(0, tokens) * resolution_price + max(0, tokens) * resolution_price
 *
 * Or simpler:
 * PnL = net_cash_flow + tokens * resolution_price (for positive tokens)
 * PnL = net_cash_flow (for negative tokens - they already got the cash from selling)
 *
 * Actually even simpler:
 * Real PnL = sum of all (cash_received from sells + tokens_held * resolution_price - cash_paid for buys)
 * But for negative positions, tokens_held is negative, so we're double-counting losses
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
  console.log(`\n=== CASHFLOW V2 ANALYSIS FOR ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  interface Position {
    tokens: number;
    cashPaid: number;
    cashReceived: number;
  }

  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const posKey = `${trade.condition_id}_${trade.outcome_index}`;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = { tokens: 0, cashPaid: 0, cashReceived: 0 };
      positions.set(posKey, pos);
    }

    if (trade.side === 'buy') {
      pos.tokens += trade.tokens;
      pos.cashPaid += trade.usdc;
    } else {
      pos.tokens -= trade.tokens;
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

  // Group by condition to see paired outcomes
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

  console.log(`\n=== PER-CONDITION ANALYSIS ===`);
  console.log('For each condition, we compute PnL correctly handling negative positions');
  console.log('');

  let totalPnl = 0;

  for (const [conditionId, { o0, o1 }] of byCondition) {
    const prices = resolutions.get(conditionId);
    const p0 = prices && prices.length > 0 ? prices[0] : 0;
    const p1 = prices && prices.length > 1 ? prices[1] : 0;

    const o0Tokens = o0?.tokens ?? 0;
    const o1Tokens = o1?.tokens ?? 0;
    const o0Cash = (o0?.cashReceived ?? 0) - (o0?.cashPaid ?? 0);
    const o1Cash = (o1?.cashReceived ?? 0) - (o1?.cashPaid ?? 0);

    // The key insight:
    // If tokens > 0: you bought them, so PnL = tokens * resolution_price - what_you_paid
    //              = tokens * resolution_price + net_cash (net_cash is negative if you paid)
    // If tokens < 0: you obtained them from split and sold them
    //              The split cost $1 per token pair (O0 + O1)
    //              Your PnL from the sale = cash_received
    //              Your cost = proportional to what the split cost for that outcome
    //              But since split gives you BOTH outcomes at cost = 1.0 total,
    //              and one outcome resolves to 1 and other to 0,
    //              the "cost" of the winning outcome is effectively 1.0

    // Simpler approach:
    // Let's compute the net tokens for the CONDITION (not individual outcomes)
    // If O0 + O1 net tokens = 0, then all tokens came from splits and were sold
    // Pure cash profit = o0Cash + o1Cash

    // If net tokens != 0, then some genuine long/short positions exist

    const netTokens = o0Tokens + o1Tokens;
    const netCash = o0Cash + o1Cash;

    // Position value at resolution
    // For positive holdings, value = tokens * resolution_price
    // For negative holdings... this is tricky.

    // Let's think about it differently:
    // PnL = cash_in - cash_out + final_token_value
    //
    // If tokens < 0 (short), you owe tokens. At resolution:
    // - If resolution = 1.0, you owe $1 per token (lose money)
    // - If resolution = 0.0, you owe $0 per token (break even on position)
    //
    // BUT if those negative tokens came from a split where you got BOTH sides,
    // and you still hold the other side, then it's paired.

    // Let's try: only count POSITIVE position values
    const o0Value = Math.max(0, o0Tokens) * p0;
    const o1Value = Math.max(0, o1Tokens) * p1;

    // For negative positions from splits, the profit is already in cashReceived
    // But we need to account for the split cost (which wasn't in CLOB)

    // Actually the cleanest approach:
    // If abs(o0Tokens) ≈ abs(o1Tokens) and signs are opposite, it's a split position
    // The net PnL is just the cash flow from trades

    const isLikelySplit = Math.sign(o0Tokens) !== Math.sign(o1Tokens) &&
                          Math.abs(Math.abs(o0Tokens) - Math.abs(o1Tokens)) < 0.1;

    let conditionPnl: number;

    if (isLikelySplit) {
      // Split position: just use cash flow
      // The tokens offset each other at resolution (one wins, one loses)
      conditionPnl = netCash;
    } else {
      // Regular position
      conditionPnl = netCash + o0Value + o1Value;

      // But what about negative positions that aren't paired?
      // If someone is short O0 and resolution is 1.0, they owe $1 per token
      if (o0Tokens < 0) conditionPnl += o0Tokens * p0;  // this is negative, reduces PnL
      if (o1Tokens < 0) conditionPnl += o1Tokens * p1;
    }

    if (Math.abs(conditionPnl) > 0.1 || Math.abs(o0Tokens) > 0.1 || Math.abs(o1Tokens) > 0.1) {
      console.log(
        `${conditionId.substring(0, 16)}... | ` +
        `O0: ${o0Tokens.toFixed(1).padStart(7)} @${p0.toFixed(1)} | ` +
        `O1: ${o1Tokens.toFixed(1).padStart(7)} @${p1.toFixed(1)} | ` +
        `Cash: $${netCash.toFixed(2).padStart(7)} | ` +
        `Split: ${isLikelySplit ? 'YES' : 'NO '} | ` +
        `PnL: $${conditionPnl.toFixed(2)}`
      );
    }

    totalPnl += conditionPnl;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total PnL (V2 method): $${totalPnl.toFixed(2)}`);
  console.log(`API PnL:               $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference:            $${apiPnl !== null ? (totalPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // Let's also try the simple formula that might match:
  // PnL = sum of (tokens_if_positive * resolution_price) + net_cash_flow
  let simplePnl = 0;
  let totalCashFlow = 0;
  let totalPositiveTokenValue = 0;

  for (const [posKey, pos] of positions) {
    const [conditionId, outcomeIndexStr] = posKey.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr);
    const prices = resolutions.get(conditionId);
    const resPrice = prices && prices.length > outcomeIndex ? prices[outcomeIndex] : 0;

    const netCash = pos.cashReceived - pos.cashPaid;
    totalCashFlow += netCash;

    // Only count positive position values
    if (pos.tokens > 0) {
      totalPositiveTokenValue += pos.tokens * resPrice;
    }
    // For negative tokens, the "loss" at resolution should NOT be counted
    // because those tokens came from splits where the split cost is already implicit
  }

  simplePnl = totalCashFlow + totalPositiveTokenValue;

  console.log(`\n=== ALTERNATIVE: Simple method ===`);
  console.log(`Net cash flow:          $${totalCashFlow.toFixed(2)}`);
  console.log(`Positive token value:   $${totalPositiveTokenValue.toFixed(2)}`);
  console.log(`Simple PnL:             $${simplePnl.toFixed(2)}`);
  console.log(`API PnL:                $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference:             $${apiPnl !== null ? (simplePnl - apiPnl).toFixed(2) : 'N/A'}`);

  process.exit(0);
}

const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
analyze(wallet).catch(console.error);
