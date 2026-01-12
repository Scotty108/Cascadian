/**
 * @deprecated EXPERIMENTAL - DO NOT USE IN PRODUCTION
 * Use pnlEngineV7.ts (API-based) instead
 *
 * PnL Engine V15 - Synthetic Cost Adjustment for Neg Risk Bundled Trades
 *
 * KEY INSIGHT from Polymarket pnl-subgraph:
 * When Buy X + Sell Y happen in same tx_hash (Neg Risk bundled trade):
 * - The sell proceeds should REDUCE the cost basis of the bought position
 * - NOT count as realized PnL
 *
 * Formula: new_avgPrice = old_avgPrice - (credit / amount)
 *
 * Example (spot_5):
 * - tx 0xd52da606...: BUY 65 tokens outcome_1 @ $60.69
 *                    SELL 64 tokens outcome_0 @ $4.57 (collateral return)
 * - V6 treats this as: cost=$60.69, realized_pnl from sell=$4.57
 * - V15 treats this as: cost=$60.69-$4.57=$56.12, no realized PnL from sell
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV15 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  bundledTxCount: number;
  regularTxCount: number;
}

interface TradeEvent {
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  side: 'buy' | 'sell';
  tokens: number;
  usdc: number;
  trade_time: Date;
}

interface Position {
  totalBought: number;
  totalSold: number;
  totalCost: number; // adjusted cost (after synthetic cost reduction)
  totalProceeds: number;
}

export async function getWalletPnLV15(wallet: string): Promise<PnLResultV15> {
  const w = wallet.toLowerCase();

  // Get all trades with tx_hash for bundled trade detection
  const query = `
    SELECT
      lower(substring(t.event_id, 1, 66)) as tx_hash,
      lower(m.condition_id) as condition_id,
      m.outcome_index,
      t.side,
      max(t.token_amount) / 1e6 as tokens,
      max(t.usdc_amount) / 1e6 as usdc,
      any(t.trade_time) as trade_time
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL AND m.condition_id != ''
    GROUP BY tx_hash, condition_id, outcome_index, side
    ORDER BY trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = (await result.json()) as TradeEvent[];

  if (trades.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      bundledTxCount: 0,
      regularTxCount: 0,
    };
  }

  // Group trades by tx_hash to detect bundled trades
  const txGroups = new Map<string, TradeEvent[]>();
  for (const trade of trades) {
    const existing = txGroups.get(trade.tx_hash) || [];
    existing.push(trade);
    txGroups.set(trade.tx_hash, existing);
  }

  // Identify bundled vs regular transactions
  // Bundled: same tx has BUY and SELL for DIFFERENT outcomes of same condition
  let bundledTxCount = 0;
  let regularTxCount = 0;

  // Track positions per condition_id + outcome_index
  const positions = new Map<string, Position>();

  for (const [txHash, txTrades] of txGroups) {
    // Check if this is a bundled Neg Risk trade
    const hasBuy = txTrades.some((t) => t.side === 'buy');
    const hasSell = txTrades.some((t) => t.side === 'sell');
    const conditions = new Set(txTrades.map((t) => t.condition_id));

    // Bundled trade: same tx, same condition, has buy AND sell for different outcomes
    const isBundled = hasBuy && hasSell && conditions.size === 1;

    if (isBundled) {
      bundledTxCount++;

      // For bundled trades:
      // 1. Buys create/add to positions
      // 2. Sells for OTHER outcomes reduce cost basis (synthetic cost adjustment)
      // 3. Sells for SAME outcome are real exits

      const buys = txTrades.filter((t) => t.side === 'buy');
      const sells = txTrades.filter((t) => t.side === 'sell');

      // Calculate total sell proceeds for cost reduction
      const totalSellProceeds = sells.reduce((sum, s) => sum + s.usdc, 0);

      // Process buys with cost reduced by sell proceeds (proportionally)
      for (const buy of buys) {
        const key = `${buy.condition_id}_${buy.outcome_index}`;
        const pos = positions.get(key) || { totalBought: 0, totalSold: 0, totalCost: 0, totalProceeds: 0 };

        // Synthetic cost adjustment: reduce cost by sell proceeds
        // If multiple buys, distribute the sell proceeds proportionally
        const buyShareOfSells =
          buys.length > 1 ? (buy.usdc / buys.reduce((s, b) => s + b.usdc, 0)) * totalSellProceeds : totalSellProceeds;

        pos.totalBought += buy.tokens;
        pos.totalCost += buy.usdc - buyShareOfSells; // REDUCED cost

        positions.set(key, pos);
      }

      // Check if any sells are for outcomes we also bought (same outcome exit)
      // This is rare but possible - treat as regular sell
      for (const sell of sells) {
        const key = `${sell.condition_id}_${sell.outcome_index}`;
        const matchingBuy = buys.find((b) => b.outcome_index === sell.outcome_index);

        if (matchingBuy) {
          // Same outcome: this is a real exit, not cost adjustment
          const pos = positions.get(key) || { totalBought: 0, totalSold: 0, totalCost: 0, totalProceeds: 0 };
          pos.totalSold += sell.tokens;
          pos.totalProceeds += sell.usdc;
          positions.set(key, pos);
        }
        // If no matching buy, the sell was already used for cost reduction above
      }
    } else {
      regularTxCount++;

      // Regular trade: process normally
      for (const trade of txTrades) {
        const key = `${trade.condition_id}_${trade.outcome_index}`;
        const pos = positions.get(key) || { totalBought: 0, totalSold: 0, totalCost: 0, totalProceeds: 0 };

        if (trade.side === 'buy') {
          pos.totalBought += trade.tokens;
          pos.totalCost += trade.usdc;
        } else {
          pos.totalSold += trade.tokens;
          pos.totalProceeds += trade.usdc;
        }

        positions.set(key, pos);
      }
    }
  }

  // Get condition IDs for resolution/mark price lookup
  const conditionIds = [...new Set([...positions.keys()].map((k) => k.split('_')[0]))];

  if (conditionIds.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      bundledTxCount,
      regularTxCount,
    };
  }

  // Fetch resolutions and mark prices
  const priceQuery = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE lower(condition_id) IN (${conditionIds.map((c) => `'${c}'`).join(',')})
  `;

  const resQuery = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${conditionIds.map((c) => `'${c}'`).join(',')})
  `;

  const [priceResult, resResult] = await Promise.all([
    clickhouse.query({ query: priceQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: resQuery, format: 'JSONEachRow' }),
  ]);

  const priceRows = (await priceResult.json()) as any[];
  const resRows = (await resResult.json()) as any[];

  const markPrices = new Map<string, number>();
  for (const row of priceRows) {
    markPrices.set(`${row.condition_id}_${row.outcome_index}`, Number(row.mark_price));
  }

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    resolutions.set(row.condition_id, row.norm_prices);
  }

  // Calculate PnL per position
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionCount = 0;

  for (const [key, pos] of positions) {
    const [conditionId, outcomeIndexStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr, 10);

    const bought = pos.totalBought;
    const sold = pos.totalSold;
    const cost = pos.totalCost;
    const proceeds = pos.totalProceeds;
    const netTokens = bought - sold;

    // Cap sells to what was bought (V1 pattern)
    let effectiveProceeds = proceeds;
    if (sold > bought && sold > 0) {
      effectiveProceeds = proceeds * (bought / sold);
    }

    const resolution = resolutions.get(conditionId);
    const isResolved = resolution && resolution.length > outcomeIndex;

    if (isResolved) {
      const payoutPrice = resolution![outcomeIndex];
      const settlementValue = Math.max(netTokens, 0) * payoutPrice;
      // V1 formula: settlement + effective_proceeds - cost
      realizedPnl += effectiveProceeds + settlementValue - cost;
    } else {
      const markPrice = markPrices.get(key) || 0;
      if (netTokens > 0) {
        positionCount++;
        const currentValue = netTokens * markPrice;
        unrealizedPnl += effectiveProceeds + currentValue - cost;
      } else if (netTokens === 0 || netTokens < 0) {
        // Closed position
        realizedPnl += effectiveProceeds - cost;
      }
    }
  }

  return {
    wallet: w,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    positionCount,
    bundledTxCount,
    regularTxCount,
  };
}
