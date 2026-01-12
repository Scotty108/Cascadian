/**
 * Debug V28 Failure - Trade-by-Trade Analysis
 *
 * Compares our local calculation vs API for a failing wallet
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

interface Position {
  conditionId: string;
  outcomeIndex: number;
  amount: number;
  avgPrice: number;
  totalCost: number;
  realizedPnl: number;
  trades: Trade[];
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

async function getResolutions(conditionIds: string[]): Promise<Map<string, number[]>> {
  if (conditionIds.length === 0) return new Map();

  const idList = conditionIds.map(id => `'${id}'`).join(',');
  const query = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as { condition_id: string; norm_prices: number[] }[];
  const map = new Map<string, number[]>();
  for (const row of rows) {
    map.set(row.condition_id, row.norm_prices);
  }
  return map;
}

async function getMarkPrices(positions: Array<{conditionId: string; outcomeIndex: number}>): Promise<Map<string, number>> {
  if (positions.length === 0) return new Map();

  const conditions = positions.map(p =>
    `(lower(condition_id) = '${p.conditionId}' AND outcome_index = ${p.outcomeIndex})`
  ).join(' OR ');

  const query = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE (${conditions}) AND mark_price IS NOT NULL
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.condition_id}_${row.outcome_index}`, Number(row.mark_price));
  }
  return map;
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
  console.log(`\n=== ANALYZING WALLET ${wallet} ===\n`);

  const [trades, apiPnl] = await Promise.all([
    getTrades(wallet),
    fetchApiPnl(wallet)
  ]);

  console.log(`Total trades: ${trades.length}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Build positions
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const posKey = `${trade.condition_id}_${trade.outcome_index}`;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = {
        conditionId: trade.condition_id,
        outcomeIndex: trade.outcome_index,
        amount: 0,
        avgPrice: 0,
        totalCost: 0,
        realizedPnl: 0,
        trades: [],
      };
      positions.set(posKey, pos);
    }

    pos.trades.push(trade);

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

  // Get resolutions
  const conditionIds = Array.from(new Set(Array.from(positions.values()).map(p => p.conditionId)));
  const resolutions = await getResolutions(conditionIds);

  // Calculate PnL
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  const openPositions: Position[] = [];
  const resolvedPositions: Position[] = [];
  const unresolvedOpenPositions: Position[] = [];

  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realizedPnl;

    if (pos.amount > 0.001) {
      const costBasis = pos.amount * pos.avgPrice;
      const prices = resolutions.get(pos.conditionId);

      if (prices && prices.length > pos.outcomeIndex) {
        const resPrice = prices[pos.outcomeIndex];
        const pnl = pos.amount * resPrice - costBasis;
        totalUnrealizedPnl += pnl;
        resolvedPositions.push(pos);
      } else {
        openPositions.push(pos);
        unresolvedOpenPositions.push({ conditionId: pos.conditionId, outcomeIndex: pos.outcomeIndex });
      }
    }
  }

  // Get mark prices for unresolved
  const markPrices = await getMarkPrices(unresolvedOpenPositions);

  for (const pos of openPositions) {
    const costBasis = pos.amount * pos.avgPrice;
    const markKey = `${pos.conditionId}_${pos.outcomeIndex}`;
    const markPrice = markPrices.get(markKey);

    if (markPrice !== undefined && markPrice > 0) {
      totalUnrealizedPnl += pos.amount * markPrice - costBasis;
    } else {
      totalUnrealizedPnl -= costBasis;
    }
  }

  const v28Total = totalRealizedPnl + totalUnrealizedPnl;
  const diff = apiPnl !== null ? v28Total - apiPnl : 0;

  console.log(`\n=== PNL SUMMARY ===`);
  console.log(`Realized PnL:   $${totalRealizedPnl.toFixed(2)}`);
  console.log(`Unrealized PnL: $${totalUnrealizedPnl.toFixed(2)}`);
  console.log(`V28 Total:      $${v28Total.toFixed(2)}`);
  console.log(`API Total:      $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Difference:     $${diff.toFixed(2)}`);

  console.log(`\n=== POSITION SUMMARY ===`);
  console.log(`Total positions: ${positions.size}`);
  console.log(`Fully closed:    ${positions.size - resolvedPositions.length - openPositions.length}`);
  console.log(`Resolved open:   ${resolvedPositions.length}`);
  console.log(`Unresolved open: ${openPositions.length}`);

  // Look for suspicious patterns - positions with both outcome 0 and 1
  const conditionsWithBothOutcomes = new Map<string, { o0: Position | null; o1: Position | null }>();
  for (const pos of positions.values()) {
    const key = pos.conditionId;
    if (!conditionsWithBothOutcomes.has(key)) {
      conditionsWithBothOutcomes.set(key, { o0: null, o1: null });
    }
    const entry = conditionsWithBothOutcomes.get(key)!;
    if (pos.outcomeIndex === 0) entry.o0 = pos;
    else if (pos.outcomeIndex === 1) entry.o1 = pos;
  }

  const multiOutcome = Array.from(conditionsWithBothOutcomes.entries())
    .filter(([_, v]) => v.o0 !== null && v.o1 !== null);

  console.log(`\n=== MULTI-OUTCOME CONDITIONS (${multiOutcome.length}) ===`);

  if (multiOutcome.length > 0) {
    console.log('\ncondition_id         | O0 amt | O0 pnl | O1 amt | O1 pnl | Combined');
    console.log('-'.repeat(85));

    let totalMultiOutcomePnl = 0;
    for (const [cid, { o0, o1 }] of multiOutcome.slice(0, 10)) {
      const o0Pnl = o0?.realizedPnl ?? 0;
      const o1Pnl = o1?.realizedPnl ?? 0;
      const combined = o0Pnl + o1Pnl;
      totalMultiOutcomePnl += combined;

      console.log(
        `${cid.substring(0, 20)}... | ` +
        `${(o0?.amount ?? 0).toFixed(1).padStart(6)} | ` +
        `$${o0Pnl.toFixed(2).padStart(6)} | ` +
        `${(o1?.amount ?? 0).toFixed(1).padStart(6)} | ` +
        `$${o1Pnl.toFixed(2).padStart(6)} | ` +
        `$${combined.toFixed(2)}`
      );
    }

    if (multiOutcome.length > 10) {
      console.log(`... and ${multiOutcome.length - 10} more`);
    }

    console.log(`\nTotal multi-outcome realized PnL: $${totalMultiOutcomePnl.toFixed(2)}`);
  }

  // Show largest realized PnL positions
  const sortedByPnl = Array.from(positions.values())
    .filter(p => Math.abs(p.realizedPnl) > 1)
    .sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl));

  console.log(`\n=== TOP 10 REALIZED PNL POSITIONS ===`);
  console.log('condition_id         | idx | amt   | avgPrice | realized | trades');
  console.log('-'.repeat(80));

  for (const pos of sortedByPnl.slice(0, 10)) {
    console.log(
      `${pos.conditionId.substring(0, 20)}... | ` +
      `${pos.outcomeIndex}   | ` +
      `${pos.amount.toFixed(1).padStart(5)} | ` +
      `$${pos.avgPrice.toFixed(4).padStart(7)} | ` +
      `$${pos.realizedPnl.toFixed(2).padStart(8)} | ` +
      `${pos.trades.length}`
    );
  }

  // Deep dive into one multi-outcome condition
  if (multiOutcome.length > 0) {
    const [sampleCid, { o0, o1 }] = multiOutcome[0];
    console.log(`\n=== DEEP DIVE: ${sampleCid} ===`);

    const allTrades = [...(o0?.trades ?? []), ...(o1?.trades ?? [])]
      .sort((a, b) => a.ts - b.ts);

    console.log('\nTrade-by-trade:');
    console.log('time       | idx | side | tokens   | price    | usdc');
    console.log('-'.repeat(70));

    for (const trade of allTrades.slice(0, 20)) {
      const time = new Date(trade.ts * 1000).toISOString().substring(11, 19);
      console.log(
        `${time} | ` +
        `${trade.outcome_index}   | ` +
        `${trade.side.padEnd(4)} | ` +
        `${trade.tokens.toFixed(2).padStart(8)} | ` +
        `$${trade.price.toFixed(4).padStart(7)} | ` +
        `$${trade.usdc.toFixed(2).padStart(6)}`
      );
    }

    if (allTrades.length > 20) {
      console.log(`... and ${allTrades.length - 20} more trades`);
    }
  }

  process.exit(0);
}

// Get wallet from command line or use worst failure
const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';
analyze(wallet).catch(console.error);
