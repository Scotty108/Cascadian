/**
 * PnL Engine V20 - Chronological Position Tracking
 *
 * KEY INSIGHT: Only credit sell proceeds for tokens actually held.
 * This eliminates "phantom sells" from complete set splits.
 *
 * APPROACH:
 * 1. Fetch all trades for wallet, ordered chronologically
 * 2. Track position per (condition, outcome) as we process trades
 * 3. For each sell: adjustedSell = min(sellTokens, currentPosition)
 * 4. Only credit sell proceeds for the adjusted amount
 *
 * This matches Polymarket's subgraph logic exactly.
 *
 * @author Claude Code
 * @version 20.0.0
 * @created 2026-01-09
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV20 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  totalVolume: number;
  phantomSellsFiltered: number;
  confidence: 'high' | 'medium' | 'low';
}

interface Trade {
  txHash: string;
  conditionId: string;
  outcomeIndex: number;
  side: 'buy' | 'sell';
  usdc: number;
  tokens: number;
  tradeTime: Date;
}

interface Position {
  tokens: number;       // Current token balance
  costBasis: number;    // Total USDC spent on buys
  realizedPnl: number;  // PnL from sells and resolutions
}

export async function getWalletPnLV20(wallet: string): Promise<PnLResultV20> {
  const w = wallet.toLowerCase();

  // Step 1: Fetch all trades ordered by time, then by tx_hash for same-tx ordering
  const tradesQuery = `
    SELECT
      substring(event_id, 1, 66) as tx_hash,
      m.condition_id as condition_id,
      toUInt8(m.outcome_index) as outcome_index,
      t.side as side,
      max(t.usdc_amount) / 1e6 as usdc,
      max(t.token_amount) / 1e6 as tokens,
      max(t.trade_time) as trade_time
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, t.side
    ORDER BY trade_time, tx_hash, condition_id, outcome_index, side DESC
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const rawTrades = (await tradesResult.json()) as Array<{
    tx_hash: string;
    condition_id: string;
    outcome_index: number;
    side: string;
    usdc: number;
    tokens: number;
    trade_time: string;
  }>;

  // Step 2: Process trades chronologically with position tracking
  const positions = new Map<string, Position>(); // key: `${conditionId}:${outcomeIndex}`
  let phantomSellsFiltered = 0;
  let totalVolume = 0;

  // Sort trades: within same tx, process BUYS before SELLS
  // This ensures we have tokens before we try to sell them in bundled txs
  const trades = [...rawTrades].sort((a, b) => {
    const timeA = new Date(a.trade_time).getTime();
    const timeB = new Date(b.trade_time).getTime();
    if (timeA !== timeB) return timeA - timeB;
    if (a.tx_hash !== b.tx_hash) return a.tx_hash.localeCompare(b.tx_hash);
    // Within same tx: buys before sells
    if (a.side !== b.side) return a.side === 'buy' ? -1 : 1;
    return 0;
  });

  for (const trade of trades) {
    const key = `${trade.condition_id}:${trade.outcome_index}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { tokens: 0, costBasis: 0, realizedPnl: 0 };
      positions.set(key, pos);
    }

    if (trade.side === 'buy') {
      pos.tokens += trade.tokens;
      pos.costBasis += trade.usdc;
      totalVolume += trade.usdc;
    } else {
      // SELL: only credit proceeds for tokens we actually hold
      const adjustedTokens = Math.min(trade.tokens, pos.tokens);
      const adjustedProceeds = adjustedTokens > 0
        ? trade.usdc * (adjustedTokens / trade.tokens)
        : 0;

      if (adjustedTokens < trade.tokens) {
        phantomSellsFiltered++;
      }

      if (adjustedTokens > 0 && pos.tokens > 0) {
        // Proportional cost basis reduction
        const avgCost = pos.costBasis / pos.tokens;
        const costReduction = avgCost * adjustedTokens;
        pos.realizedPnl += adjustedProceeds - costReduction;
        pos.costBasis -= costReduction;
        pos.tokens -= adjustedTokens;
      }
      totalVolume += adjustedProceeds;
    }
  }

  // Step 3: Fetch resolutions for settled positions
  const resolutionsQuery = `
    SELECT
      lower(condition_id) as condition_id,
      norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (
      SELECT DISTINCT lower(condition_id)
      FROM (
        SELECT m.condition_id
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${w}'
          AND m.condition_id IS NOT NULL AND m.condition_id != ''
      )
    )
  `;

  const resResult = await clickhouse.query({ query: resolutionsQuery, format: 'JSONEachRow' });
  const resolutions = (await resResult.json()) as Array<{
    condition_id: string;
    norm_prices: number[];
  }>;

  const resolutionMap = new Map<string, number[]>();
  for (const r of resolutions) {
    resolutionMap.set(r.condition_id.toLowerCase(), r.norm_prices);
  }

  // Step 4: Fetch mark prices for unrealized PnL
  const markPricesQuery = `
    SELECT
      lower(condition_id) as condition_id,
      outcome_index,
      mark_price
    FROM pm_latest_mark_price_v1
    WHERE lower(condition_id) IN (
      SELECT DISTINCT lower(condition_id)
      FROM (
        SELECT m.condition_id
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${w}'
          AND m.condition_id IS NOT NULL AND m.condition_id != ''
      )
    )
  `;

  const markResult = await clickhouse.query({ query: markPricesQuery, format: 'JSONEachRow' });
  const markPrices = (await markResult.json()) as Array<{
    condition_id: string;
    outcome_index: number;
    mark_price: number;
  }>;

  const markPriceMap = new Map<string, number>();
  for (const mp of markPrices) {
    markPriceMap.set(`${mp.condition_id.toLowerCase()}:${mp.outcome_index}`, mp.mark_price);
  }

  // Step 5: Calculate final PnL
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = 0;

  for (const [key, pos] of positions) {
    const [conditionId, outcomeIndexStr] = key.split(':');
    const outcomeIndex = parseInt(outcomeIndexStr, 10);
    const resolution = resolutionMap.get(conditionId.toLowerCase());

    realizedPnl += pos.realizedPnl;

    if (pos.tokens > 0) {
      if (resolution && resolution.length > outcomeIndex) {
        // Resolved: add settlement payout to realized
        const payout = pos.tokens * resolution[outcomeIndex];
        realizedPnl += payout - pos.costBasis;
        closedCount++;
      } else {
        // Open: calculate unrealized
        const markPrice = markPriceMap.get(key) || 0;
        if (markPrice > 0 && pos.costBasis > 0) {
          const avgCost = pos.costBasis / pos.tokens;
          unrealizedPnl += pos.tokens * (markPrice - avgCost);
        }
        openCount++;
      }
    } else {
      closedCount++;
    }
  }

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    totalVolume,
    phantomSellsFiltered,
    confidence: phantomSellsFiltered > 10 ? 'medium' : 'high',
  };
}

// Test function
export async function compareWithApiV20(wallet: string): Promise<{
  v20Result: PnLResultV20;
  apiPnl: number | null;
  difference: number | null;
  percentDiff: number | null;
  matches: boolean;
}> {
  const v20Result = await getWalletPnLV20(wallet);

  let apiPnl: number | null = null;
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        apiPnl = data[data.length - 1].p;
      }
    }
  } catch {
    // API unavailable
  }

  if (apiPnl === null) {
    return { v20Result, apiPnl: null, difference: null, percentDiff: null, matches: false };
  }

  const difference = v20Result.totalPnl - apiPnl;
  const percentDiff = apiPnl !== 0 ? (Math.abs(difference) / Math.abs(apiPnl)) * 100 : null;
  const matches = Math.abs(difference) < 5 || (percentDiff !== null && percentDiff < 10);

  return { v20Result, apiPnl, difference, percentDiff, matches };
}
