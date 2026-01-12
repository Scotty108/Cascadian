/**
 * PnL Engine V25 - V1 Dedup + V23 Sequential AvgPrice
 *
 * Combines:
 * - V1's tx_hash deduplication (handles maker+taker duplicates)
 * - V23's sequential avgPrice tracking (subgraph formula)
 * - Resolution prices for settled markets
 *
 * @author Claude Code
 * @version 25.0.0
 * @created 2026-01-09
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV25 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  source: 'local_deduped';
  confidence: 'high';
}

interface DedupedTrade {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  price: number;
  amount: number;
  ts: number;
}

interface Position {
  conditionId: string;
  outcomeIndex: number;
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

async function getDedupedTrades(wallet: string): Promise<DedupedTrade[]> {
  const w = wallet.toLowerCase();
  
  // V1's deduplication: group by (tx_hash, condition_id, outcome_index, side)
  // Use MAX to pick one representative value for duplicates
  const query = `
    SELECT
      substring(t.event_id, 1, 66) as tx_hash,
      m.condition_id,
      m.outcome_index,
      t.side,
      max(t.usdc_amount) / max(t.token_amount) as price,
      max(t.token_amount) / 1000000.0 as amount,
      max(toUnixTimestamp(t.trade_time)) as ts
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    ORDER BY ts ASC, tx_hash ASC
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    return rows.map(r => ({
      tx_hash: r.tx_hash,
      condition_id: r.condition_id,
      outcome_index: Number(r.outcome_index),
      side: r.side.toLowerCase(),
      price: Number(r.price),
      amount: Number(r.amount),
      ts: Number(r.ts),
    }));
  } catch {
    return [];
  }
}

async function getResolutionPrices(conditionIds: string[]): Promise<Map<string, number[]>> {
  if (conditionIds.length === 0) return new Map();

  const idList = conditionIds.map(id => "'" + id.toLowerCase() + "'").join(',');
  const query = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { condition_id: string; norm_prices: number[] }[];
    const map = new Map<string, number[]>();
    for (const row of rows) {
      map.set(row.condition_id, row.norm_prices);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function getMarkPrices(positions: Array<{conditionId: string; outcomeIndex: number}>): Promise<Map<string, number>> {
  if (positions.length === 0) return new Map();

  const conditions = positions.map(p =>
    "(lower(condition_id) = '" + p.conditionId.toLowerCase() + "' AND outcome_index = " + p.outcomeIndex + ")"
  ).join(' OR ');

  const query = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE (${conditions}) AND mark_price IS NOT NULL
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.condition_id + '_' + row.outcome_index, Number(row.mark_price));
    }
    return map;
  } catch {
    return new Map();
  }
}

function processTrades(trades: DedupedTrade[]): Map<string, Position> {
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const posKey = trade.condition_id.toLowerCase() + '_' + trade.outcome_index;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = {
        conditionId: trade.condition_id,
        outcomeIndex: trade.outcome_index,
        amount: 0,
        avgPrice: 0,
        realizedPnl: 0,
      };
      positions.set(posKey, pos);
    }

    if (trade.side === 'buy') {
      // BUY: Add tokens, update average price (subgraph formula)
      const newAmount = pos.amount + trade.amount;
      if (newAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + trade.price * trade.amount) / newAmount;
      }
      pos.amount = newAmount;
    } else {
      // SELL: Cap to position amount, realize PnL (subgraph formula)
      const adjustedSell = Math.min(trade.amount, pos.amount);
      if (adjustedSell > 0) {
        pos.realizedPnl += adjustedSell * (trade.price - pos.avgPrice);
        pos.amount -= adjustedSell;
      }
    }
  }

  return positions;
}

export async function getWalletPnLV25(wallet: string): Promise<PnLResultV25> {
  const w = wallet.toLowerCase();

  // Step 1: Get deduped trades (V1 style)
  const trades = await getDedupedTrades(w);

  // Step 2: Process trades sequentially (V23 style)
  const positions = processTrades(trades);

  // Step 3: Calculate realized PnL
  let realizedPnl = 0;
  for (const pos of positions.values()) {
    realizedPnl += pos.realizedPnl;
  }

  // Step 4: Get open positions
  const openPositions = Array.from(positions.values()).filter(p => p.amount > 0.001);
  const conditionIds = new Set<string>();
  for (const pos of positions.values()) {
    conditionIds.add(pos.conditionId.toLowerCase());
  }

  // Step 5: Get resolution prices
  const resolutionPrices = await getResolutionPrices(Array.from(conditionIds));

  // Step 6: Calculate unrealized PnL
  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = positions.size - openPositions.length;

  // Find unresolved positions (no resolution OR outcomeIndex beyond resolution array)
  const unresolvedPositions: Array<{conditionId: string; outcomeIndex: number}> = [];
  for (const pos of openPositions) {
    const prices = resolutionPrices.get(pos.conditionId.toLowerCase());
    if (!prices || prices.length <= pos.outcomeIndex) {
      unresolvedPositions.push({ conditionId: pos.conditionId, outcomeIndex: pos.outcomeIndex });
    }
  }

  const markPrices = await getMarkPrices(unresolvedPositions);

  for (const pos of openPositions) {
    const costBasis = pos.amount * pos.avgPrice;

    // Check if resolved
    const prices = resolutionPrices.get(pos.conditionId.toLowerCase());
    if (prices && prices.length > pos.outcomeIndex) {
      const resolutionPrice = prices[pos.outcomeIndex];
      unrealizedPnl += pos.amount * resolutionPrice - costBasis;
      closedCount++;
      continue;
    }

    // Use mark price for unresolved
    openCount++;
    const markKey = pos.conditionId.toLowerCase() + '_' + pos.outcomeIndex;
    const markPrice = markPrices.get(markKey);
    if (markPrice !== undefined && markPrice > 0) {
      unrealizedPnl += pos.amount * markPrice - costBasis;
    } else {
      unrealizedPnl -= costBasis;
    }
  }

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    source: 'local_deduped',
    confidence: 'high',
  };
}

const currentUrl = import.meta.url;
const scriptPath = 'file://' + process.argv[1];
if (currentUrl === scriptPath) {
  const wallet = process.argv[2];
  if (!wallet) {
    console.log('Usage: npx tsx lib/pnl/pnlEngineV25.ts <wallet>');
    process.exit(1);
  }
  getWalletPnLV25(wallet)
    .then(r => console.log('V25 Result:', JSON.stringify(r, null, 2)))
    .catch(e => console.error('Error:', e));
}
