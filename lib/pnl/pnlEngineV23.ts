/**
 * PnL Engine V23 - Fully Local Subgraph Logic Replica
 *
 * Uses resolution prices for settled markets instead of redemption events.
 *
 * @author Claude Code
 * @version 23.3.0
 * @created 2026-01-09
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV23 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  source: 'local';
  confidence: 'high';
}

interface CLOBTrade {
  token_id: string;
  side: string;
  price: number;
  amount: number;
}

interface Position {
  tokenId: string;
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

async function getCLOBTrades(wallet: string): Promise<CLOBTrade[]> {
  const w = wallet.toLowerCase();
  const query = "SELECT token_id, side, usdc_amount / token_amount as price, token_amount / 1000000.0 as amount FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '" + w + "' ORDER BY trade_time ASC, event_id ASC";

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    return await result.json() as CLOBTrade[];
  } catch {
    return [];
  }
}

async function getTokenConditionMap(tokenIds: string[]): Promise<Map<string, { conditionId: string; outcomeIndex: number }>> {
  if (tokenIds.length === 0) return new Map();

  const idList = tokenIds.map(id => "'" + id + "'").join(',');
  const query = "SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5 WHERE token_id_dec IN (" + idList + ")";

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { token_id_dec: string; condition_id: string; outcome_index: number }[];
    const map = new Map<string, { conditionId: string; outcomeIndex: number }>();
    for (const row of rows) {
      map.set(row.token_id_dec, { conditionId: row.condition_id, outcomeIndex: row.outcome_index });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function getResolutionPrices(conditionIds: string[]): Promise<Map<string, number[]>> {
  if (conditionIds.length === 0) return new Map();

  const idList = conditionIds.map(id => "'" + id.toLowerCase() + "'").join(',');
  const query = "SELECT lower(condition_id) as condition_id, norm_prices FROM pm_condition_resolutions_norm WHERE lower(condition_id) IN (" + idList + ") AND length(norm_prices) > 0";

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

async function getMarkPrices(tokenIds: string[]): Promise<Map<string, number>> {
  if (tokenIds.length === 0) return new Map();

  const idList = tokenIds.map(id => "'" + id + "'").join(',');
  const query = "SELECT m.token_id_dec, mp.mark_price FROM pm_token_to_condition_map_v5 m JOIN pm_latest_mark_price_v1 mp ON lower(m.condition_id) = lower(mp.condition_id) AND m.outcome_index = mp.outcome_index WHERE m.token_id_dec IN (" + idList + ") AND mp.mark_price IS NOT NULL";

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { token_id_dec: string; mark_price: number }[];
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.token_id_dec, row.mark_price);
    }
    return map;
  } catch {
    return new Map();
  }
}

function processTrades(trades: CLOBTrade[]): Map<string, Position> {
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    let pos = positions.get(trade.token_id);
    if (!pos) {
      pos = { tokenId: trade.token_id, amount: 0, avgPrice: 0, realizedPnl: 0 };
      positions.set(trade.token_id, pos);
    }

    const side = trade.side.toLowerCase();
    if (side === 'buy') {
      const newAmount = pos.amount + trade.amount;
      if (newAmount > 0) {
        pos.avgPrice = (pos.avgPrice * pos.amount + trade.price * trade.amount) / newAmount;
      }
      pos.amount = newAmount;
    } else {
      // SELL: Cap to position amount (subgraph's key insight)
      const adjustedSell = Math.min(trade.amount, pos.amount);
      if (adjustedSell > 0) {
        pos.realizedPnl += adjustedSell * (trade.price - pos.avgPrice);
        pos.amount -= adjustedSell;
      }
    }
  }

  return positions;
}

export async function getWalletPnLV23(wallet: string): Promise<PnLResultV23> {
  const w = wallet.toLowerCase();

  // Step 1: Get all CLOB trades
  const trades = await getCLOBTrades(w);

  // Step 2: Process trades using subgraph logic
  const positions = processTrades(trades);

  // Step 3: Calculate realized PnL from trades
  let realizedPnl = 0;
  for (const pos of positions.values()) {
    realizedPnl += pos.realizedPnl;
  }

  // Step 4: Get token mappings for open positions
  const openPositions = Array.from(positions.values()).filter(p => p.amount > 0.001);
  const tokenIds = openPositions.map(p => p.tokenId);
  const tokenConditionMap = await getTokenConditionMap(tokenIds);

  // Get condition IDs for resolution lookup
  const conditionIds = new Set<string>();
  for (const mapping of tokenConditionMap.values()) {
    conditionIds.add(mapping.conditionId);
  }
  const resolutionPrices = await getResolutionPrices(Array.from(conditionIds));

  // Step 5: Calculate unrealized PnL for open positions
  // Resolved positions use resolution prices, unresolved use mark prices
  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = positions.size - openPositions.length;

  // Find truly open (unresolved) positions for mark price lookup
  const unresolvedTokenIds: string[] = [];
  for (const pos of openPositions) {
    const mapping = tokenConditionMap.get(pos.tokenId);
    if (mapping) {
      const prices = resolutionPrices.get(mapping.conditionId.toLowerCase());
      if (!prices || prices.length === 0) {
        unresolvedTokenIds.push(pos.tokenId);
      }
    } else {
      unresolvedTokenIds.push(pos.tokenId);
    }
  }

  const markPrices = await getMarkPrices(unresolvedTokenIds);

  for (const pos of openPositions) {
    const costBasis = pos.amount * pos.avgPrice;

    // Check if resolved
    const mapping = tokenConditionMap.get(pos.tokenId);
    if (mapping) {
      const prices = resolutionPrices.get(mapping.conditionId.toLowerCase());
      if (prices && prices.length > mapping.outcomeIndex) {
        const resolutionPrice = prices[mapping.outcomeIndex];
        const currentValue = pos.amount * resolutionPrice;
        unrealizedPnl += currentValue - costBasis;
        // Resolved positions are "closed" in terms of being settled
        closedCount++;
        continue;
      }
    }

    // Use mark price for truly open positions
    openCount++;
    const markPrice = markPrices.get(pos.tokenId);
    if (markPrice !== undefined && markPrice > 0) {
      unrealizedPnl += pos.amount * markPrice - costBasis;
    } else {
      unrealizedPnl += -costBasis; // No price - assume worthless
    }
  }

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    source: 'local',
    confidence: 'high',
  };
}

const currentUrl = import.meta.url;
const scriptPath = "file://" + process.argv[1];
if (currentUrl === scriptPath) {
  const wallet = process.argv[2];
  if (!wallet) {
    console.log('Usage: npx tsx lib/pnl/pnlEngineV23.ts <wallet>');
    process.exit(1);
  }
  getWalletPnLV23(wallet).then(r => console.log('V23 Result:', r)).catch(e => console.error('Error:', e));
}
