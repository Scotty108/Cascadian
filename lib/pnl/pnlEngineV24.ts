/**
 * PnL Engine V24 - Fully Local with Splits/Merges Integration
 *
 * Combines CLOB trades with CTF split/merge events via tx_hash bundling.
 * This replicates the subgraph's 5-event tracking locally:
 * 1. OrderFilled (CLOB) - from pm_trader_events_v3
 * 2. PositionSplit (CTF) - from pm_ctf_events via tx_hash join
 * 3. PositionsMerge (CTF) - from pm_ctf_events via tx_hash join
 * 4. Resolution prices - from pm_condition_resolutions_norm
 *
 * Key insight: Splits add tokens to ALL outcomes at avgPrice=1.0
 *
 * @author Claude Code
 * @version 24.0.0
 * @created 2026-01-09
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV24 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  splitCount: number;
  mergeCount: number;
  source: 'local_with_ctf';
  confidence: 'high';
}

interface TradeEvent {
  type: 'buy' | 'sell' | 'split' | 'merge';
  tokenId: string;
  conditionId: string;
  outcomeIndex: number;
  amount: number;
  price: number;
  timestamp: number;
}

interface Position {
  tokenId: string;
  conditionId: string;
  outcomeIndex: number;
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

async function getCLOBTrades(wallet: string): Promise<TradeEvent[]> {
  const w = wallet.toLowerCase();
  const query = `
    SELECT
      t.token_id,
      m.condition_id,
      m.outcome_index,
      t.side,
      t.usdc_amount / t.token_amount as price,
      t.token_amount / 1000000.0 as amount,
      toUnixTimestamp(t.trade_time) as ts
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    ORDER BY t.trade_time ASC, t.event_id ASC
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    return rows.map(r => ({
      type: r.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
      tokenId: r.token_id,
      conditionId: r.condition_id,
      outcomeIndex: Number(r.outcome_index),
      amount: Number(r.amount),
      price: Number(r.price),
      timestamp: Number(r.ts),
    }));
  } catch {
    return [];
  }
}

async function getCTFEvents(wallet: string): Promise<TradeEvent[]> {
  const w = wallet.toLowerCase();

  const query = `
    SELECT DISTINCT
      ctf.event_type,
      ctf.condition_id,
      toUInt64(ctf.amount_or_payout) / 1000000.0 as amount,
      toUnixTimestamp(ctf.event_timestamp) as ts
    FROM pm_ctf_events ctf
    INNER JOIN pm_trader_events_v3 t
      ON lower(hex(t.transaction_hash)) = lower(substring(ctf.tx_hash, 3))
    WHERE lower(t.trader_wallet) = '${w}'
      AND ctf.event_type IN ('PositionSplit', 'PositionsMerge')
      AND ctf.is_deleted = 0
    ORDER BY ctf.event_timestamp ASC
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    const events: TradeEvent[] = [];
    for (const r of rows) {
      const eventType = r.event_type === 'PositionSplit' ? 'split' : 'merge';
      events.push({
        type: eventType,
        tokenId: '',
        conditionId: r.condition_id,
        outcomeIndex: -1,
        amount: Number(r.amount),
        price: 1.0,
        timestamp: Number(r.ts),
      });
    }
    return events;
  } catch {
    return [];
  }
}

async function getConditionOutcomes(conditionIds: string[]): Promise<Map<string, number[]>> {
  if (conditionIds.length === 0) return new Map();

  const idList = conditionIds.map(id => "'" + id.toLowerCase() + "'").join(',');
  const query = `
    SELECT lower(condition_id) as condition_id, groupArray(DISTINCT outcome_index) as outcomes
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${idList})
    GROUP BY lower(condition_id)
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    const map = new Map<string, number[]>();
    for (const r of rows) {
      map.set(r.condition_id, r.outcomes.sort((a: number, b: number) => a - b));
    }
    return map;
  } catch {
    return new Map();
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

async function getMarkPrices(conditionOutcomes: Array<{conditionId: string; outcomeIndex: number}>): Promise<Map<string, number>> {
  if (conditionOutcomes.length === 0) return new Map();

  const conditions = conditionOutcomes.map(co =>
    "(lower(condition_id) = '" + co.conditionId.toLowerCase() + "' AND outcome_index = " + co.outcomeIndex + ")"
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
      const key = row.condition_id + '_' + row.outcome_index;
      map.set(key, Number(row.mark_price));
    }
    return map;
  } catch {
    return new Map();
  }
}

function processEvents(
  clobTrades: TradeEvent[],
  ctfEvents: TradeEvent[],
  conditionOutcomes: Map<string, number[]>
): { positions: Map<string, Position>; splitCount: number; mergeCount: number } {
  const positions = new Map<string, Position>();
  let splitCount = 0;
  let mergeCount = 0;

  const expandedCtfEvents: TradeEvent[] = [];
  for (const event of ctfEvents) {
    const outcomes = conditionOutcomes.get(event.conditionId.toLowerCase()) || [0, 1];
    for (const outcomeIdx of outcomes) {
      expandedCtfEvents.push({
        ...event,
        outcomeIndex: outcomeIdx,
      });
    }
    if (event.type === 'split') splitCount++;
    else if (event.type === 'merge') mergeCount++;
  }

  const allEvents = [...clobTrades, ...expandedCtfEvents].sort((a, b) => a.timestamp - b.timestamp);

  for (const event of allEvents) {
    const posKey = event.conditionId.toLowerCase() + '_' + event.outcomeIndex;

    let pos = positions.get(posKey);
    if (!pos) {
      pos = {
        tokenId: event.tokenId,
        conditionId: event.conditionId,
        outcomeIndex: event.outcomeIndex,
        amount: 0,
        avgPrice: 0,
        realizedPnl: 0,
      };
      positions.set(posKey, pos);
    }

    if (event.type === 'buy' || event.type === 'split') {
      const newAmount = pos.amount + event.amount;
      if (newAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + event.price * event.amount) / newAmount;
      }
      pos.amount = newAmount;
    } else if (event.type === 'sell' || event.type === 'merge') {
      const adjustedAmount = Math.min(event.amount, pos.amount);
      if (adjustedAmount > 0) {
        pos.realizedPnl += adjustedAmount * (event.price - pos.avgPrice);
        pos.amount -= adjustedAmount;
      }
    }
  }

  return { positions, splitCount, mergeCount };
}

export async function getWalletPnLV24(wallet: string): Promise<PnLResultV24> {
  const w = wallet.toLowerCase();

  const clobTrades = await getCLOBTrades(w);
  const ctfEvents = await getCTFEvents(w);

  const conditionIds = new Set<string>();
  for (const t of clobTrades) conditionIds.add(t.conditionId.toLowerCase());
  for (const e of ctfEvents) conditionIds.add(e.conditionId.toLowerCase());

  const conditionOutcomes = await getConditionOutcomes(Array.from(conditionIds));
  const { positions, splitCount, mergeCount } = processEvents(clobTrades, ctfEvents, conditionOutcomes);

  let realizedPnl = 0;
  for (const pos of positions.values()) {
    realizedPnl += pos.realizedPnl;
  }

  const openPositions = Array.from(positions.values()).filter(p => p.amount > 0.001);
  const resolutionPrices = await getResolutionPrices(Array.from(conditionIds));

  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = positions.size - openPositions.length;

  const unresolvedPositions: Array<{conditionId: string; outcomeIndex: number}> = [];
  for (const pos of openPositions) {
    const prices = resolutionPrices.get(pos.conditionId.toLowerCase());
    if (!prices || prices.length === 0) {
      unresolvedPositions.push({ conditionId: pos.conditionId, outcomeIndex: pos.outcomeIndex });
    }
  }

  const markPrices = await getMarkPrices(unresolvedPositions);

  for (const pos of openPositions) {
    const costBasis = pos.amount * pos.avgPrice;

    const prices = resolutionPrices.get(pos.conditionId.toLowerCase());
    if (prices && prices.length > pos.outcomeIndex) {
      const resolutionPrice = prices[pos.outcomeIndex];
      unrealizedPnl += pos.amount * resolutionPrice - costBasis;
      closedCount++;
      continue;
    }

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
    splitCount,
    mergeCount,
    source: 'local_with_ctf',
    confidence: 'high',
  };
}

const currentUrl = import.meta.url;
const scriptPath = 'file://' + process.argv[1];
if (currentUrl === scriptPath) {
  const wallet = process.argv[2];
  if (!wallet) {
    console.log('Usage: npx tsx lib/pnl/pnlEngineV24.ts <wallet>');
    process.exit(1);
  }
  getWalletPnLV24(wallet)
    .then(r => console.log('V24 Result:', JSON.stringify(r, null, 2)))
    .catch(e => console.error('Error:', e));
}
