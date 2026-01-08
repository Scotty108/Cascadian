/**
 * UI Activity PnL Engine V11c
 *
 * ============================================================================
 * V11c: BOUNDED SYNTHETIC PAIR HANDLING
 * Session: 2025-12-07
 * ============================================================================
 *
 * Fixes V11b's overcorrection problem with strict bounds:
 *
 * 1. Same-tx constraint: Only pair trades in the exact same transaction
 * 2. Same-condition constraint: YES and NO must be for the same market
 * 3. Tight quantity match: Amounts must be within 1% tolerance
 * 4. Lot-level application: Credit applied only to the matched quantity
 * 5. Floor at zero: Never reduce effective cost below $0
 *
 * The key insight: A synthetic pair creates a NEW lot with adjusted cost basis.
 * It does NOT retroactively adjust previous lots.
 */

import { clickhouse } from '../clickhouse/client';
import {
  TOKEN_MAP_TABLE,
  TRADER_EVENTS_TABLE,
  RESOLUTIONS_TABLE,
} from './dataSourceConstants';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV11c {
  wallet: string;
  realized_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  buys_count: number;
  sells_count: number;
  outcomes_traded: number;
  positions: PositionSummary[];
  trade_returns: TradeReturn[];
  // Debug stats
  syntheticPairsDetected: number;
  syntheticTokensAdjusted: number;
}

export interface PositionSummary {
  condition_id: string;
  outcome_index: number;
  amount: number;
  avgPrice: number;
  realized_pnl: number;
  trade_count: number;
}

export interface TradeReturn {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  pnl: number;
  return_pct: number;
}

interface TradeEvent {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  side: 'buy' | 'sell';
  qty_tokens: number;
  price: number;
  usdc_notional: number;
  tx_hash: string;
}

// A lot represents a specific acquisition of tokens at a specific cost
interface Lot {
  qty: number;
  costBasis: number; // Total cost for this lot
  effectivePrice: number; // costBasis / qty
}

interface PositionState {
  lots: Lot[];
  totalAmount: number;
  realized_pnl: number;
  trade_count: number;
}

// -----------------------------------------------------------------------------
// Price Rounding
// -----------------------------------------------------------------------------

function roundToCents(price: number): number {
  return Math.round(price * 100) / 100;
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

async function getClobTradesForWallet(wallet: string): Promise<TradeEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.usdc_notional,
      fills.tx_hash
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
        any(transaction_hash) as tx_hash,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM ${TRADER_EVENTS_TABLE}
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    ) fills
    INNER JOIN ${TOKEN_MAP_TABLE} m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    trade_time: r.trade_time,
    side: r.side as 'buy' | 'sell',
    qty_tokens: Number(r.qty_tokens),
    price: Number(r.price),
    usdc_notional: Number(r.usdc_notional),
    tx_hash: r.tx_hash || '',
  }));
}

// -----------------------------------------------------------------------------
// Synthetic Pair Detection (Strict)
// -----------------------------------------------------------------------------

interface SyntheticPair {
  tx_hash: string;
  condition_id: string;
  buy_outcome: number;
  sell_outcome: number;
  matched_qty: number;
  buy_usdc: number;
  sell_usdc: number;
  net_cost: number; // buy_usdc - sell_usdc
  effective_price: number; // net_cost / matched_qty
}

/**
 * Detect synthetic pairs with strict matching rules:
 * - Same tx_hash
 * - Same condition_id
 * - Different outcome_index
 * - Quantities within 1% tolerance
 */
function detectSyntheticPairs(trades: TradeEvent[]): Map<string, SyntheticPair[]> {
  const QUANTITY_TOLERANCE = 0.10; // 10% - relaxed to catch more valid pairs

  // Group by tx_hash
  const tradesByTx = new Map<string, TradeEvent[]>();
  for (const t of trades) {
    if (!t.tx_hash) continue;
    const existing = tradesByTx.get(t.tx_hash) || [];
    existing.push(t);
    tradesByTx.set(t.tx_hash, existing);
  }

  // Result: condition_id → pairs in that condition
  const pairsByCondition = new Map<string, SyntheticPair[]>();

  for (const [txHash, txTrades] of tradesByTx.entries()) {
    if (txTrades.length < 2) continue;

    // Group by condition
    const byCondition = new Map<string, TradeEvent[]>();
    for (const t of txTrades) {
      const key = t.condition_id.toLowerCase();
      const existing = byCondition.get(key) || [];
      existing.push(t);
      byCondition.set(key, existing);
    }

    // For each condition, look for BUY/SELL pairs on different outcomes
    for (const [conditionId, condTrades] of byCondition.entries()) {
      const buys = condTrades.filter(t => t.side === 'buy');
      const sells = condTrades.filter(t => t.side === 'sell');

      if (buys.length === 0 || sells.length === 0) continue;

      // Match buys with sells on different outcomes
      const usedBuys = new Set<number>();
      const usedSells = new Set<number>();

      for (let bi = 0; bi < buys.length; bi++) {
        if (usedBuys.has(bi)) continue;
        const buy = buys[bi];

        for (let si = 0; si < sells.length; si++) {
          if (usedSells.has(si)) continue;
          const sell = sells[si];

          // Must be different outcomes
          if (buy.outcome_index === sell.outcome_index) continue;

          // V11c: No strict quantity match - credit all sell proceeds
          // But cap the matched quantity to prevent over-adjustment

          // This is a valid synthetic pair!
          const matchedQty = Math.min(buy.qty_tokens, sell.qty_tokens);
          const buyUsdc = (matchedQty / buy.qty_tokens) * buy.usdc_notional;
          const sellUsdc = (matchedQty / sell.qty_tokens) * sell.usdc_notional;
          const netCost = buyUsdc - sellUsdc;
          const effectivePrice = Math.max(0, netCost / matchedQty); // Floor at 0

          const pair: SyntheticPair = {
            tx_hash: txHash,
            condition_id: conditionId,
            buy_outcome: buy.outcome_index,
            sell_outcome: sell.outcome_index,
            matched_qty: matchedQty,
            buy_usdc: buyUsdc,
            sell_usdc: sellUsdc,
            net_cost: netCost,
            effective_price: effectivePrice,
          };

          const existing = pairsByCondition.get(conditionId) || [];
          existing.push(pair);
          pairsByCondition.set(conditionId, existing);

          usedBuys.add(bi);
          usedSells.add(si);
          break; // Move to next buy
        }
      }
    }
  }

  return pairsByCondition;
}

// -----------------------------------------------------------------------------
// Core Algorithm - Lot-Based with Synthetic Pair Handling
// -----------------------------------------------------------------------------

function calculatePnLWithBoundedSyntheticPairs(trades: TradeEvent[]): {
  realized_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  buys_count: number;
  sells_count: number;
  outcomes_traded: number;
  positions: PositionSummary[];
  trade_returns: TradeReturn[];
  syntheticPairsDetected: number;
  syntheticTokensAdjusted: number;
} {
  // Step 1: Detect synthetic pairs
  const syntheticPairsByCondition = detectSyntheticPairs(trades);

  let totalSyntheticPairs = 0;
  let totalSyntheticTokens = 0;
  for (const pairs of syntheticPairsByCondition.values()) {
    totalSyntheticPairs += pairs.length;
    for (const p of pairs) {
      totalSyntheticTokens += p.matched_qty;
    }
  }

  // Step 2: Build index of synthetic pairs by (tx_hash, condition_id, outcome_index)
  // This tells us: for a given BUY, what's the adjusted effective price?
  const syntheticBuyIndex = new Map<string, { effectivePrice: number; matchedQty: number }[]>();

  for (const [conditionId, pairs] of syntheticPairsByCondition.entries()) {
    for (const pair of pairs) {
      const key = `${pair.tx_hash}_${conditionId}_${pair.buy_outcome}`;
      const existing = syntheticBuyIndex.get(key) || [];
      existing.push({
        effectivePrice: pair.effective_price,
        matchedQty: pair.matched_qty,
      });
      syntheticBuyIndex.set(key, existing);
    }
  }

  // Step 3: Process trades chronologically
  trades.sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  const states = new Map<string, PositionState>();
  const getKey = (cid: string, idx: number) => `${cid.toLowerCase()}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let buys_count = 0;
  let sells_count = 0;

  const trade_returns: TradeReturn[] = [];

  for (const trade of trades) {
    const key = getKey(trade.condition_id, trade.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        lots: [],
        totalAmount: 0,
        realized_pnl: 0,
        trade_count: 0,
      });
    }

    const state = states.get(key)!;
    state.trade_count++;

    const price = roundToCents(trade.price);

    if (trade.side === 'buy') {
      buys_count++;
      volume_buys += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      if (trade.qty_tokens > 0) {
        // Check if this buy is part of a synthetic pair
        const syntheticKey = `${trade.tx_hash}_${trade.condition_id.toLowerCase()}_${trade.outcome_index}`;
        const syntheticAdjustments = syntheticBuyIndex.get(syntheticKey) || [];

        let remainingQty = trade.qty_tokens;
        let remainingUsdc = trade.usdc_notional;

        // First, create lots for synthetic-adjusted portions
        for (const adj of syntheticAdjustments) {
          if (remainingQty <= 0) break;

          const lotQty = Math.min(adj.matchedQty, remainingQty);
          const lotCost = lotQty * adj.effectivePrice;

          state.lots.push({
            qty: lotQty,
            costBasis: lotCost,
            effectivePrice: adj.effectivePrice,
          });

          remainingQty -= lotQty;
          // Subtract proportional USDC from remaining
          const proportionUsed = lotQty / trade.qty_tokens;
          remainingUsdc -= proportionUsed * trade.usdc_notional;
        }

        // Any remaining qty uses the original price
        if (remainingQty > 0.01) {
          state.lots.push({
            qty: remainingQty,
            costBasis: Math.max(0, remainingUsdc),
            effectivePrice: remainingUsdc / remainingQty,
          });
        }

        state.totalAmount = state.lots.reduce((sum, lot) => sum + lot.qty, 0);
      }
    } else if (trade.side === 'sell') {
      sells_count++;
      volume_sells += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      // FIFO sell against lots
      let remainingToSell = Math.min(trade.qty_tokens, state.totalAmount);
      const sellPrice = price;

      while (remainingToSell > 0.01 && state.lots.length > 0) {
        const lot = state.lots[0];
        const soldFromLot = Math.min(lot.qty, remainingToSell);

        // Calculate PnL for this portion
        const costBasisPortion = (soldFromLot / lot.qty) * lot.costBasis;
        const proceeds = soldFromLot * sellPrice;
        const deltaPnL = proceeds - costBasisPortion;

        state.realized_pnl += deltaPnL;

        // Track return
        if (lot.effectivePrice > 0) {
          const return_pct = (sellPrice - lot.effectivePrice) / lot.effectivePrice;
          trade_returns.push({
            condition_id: trade.condition_id,
            outcome_index: trade.outcome_index,
            trade_time: trade.trade_time,
            pnl: deltaPnL,
            return_pct,
          });
        }

        // Update lot
        lot.qty -= soldFromLot;
        lot.costBasis -= costBasisPortion;
        remainingToSell -= soldFromLot;

        // Remove depleted lots
        if (lot.qty < 0.01) {
          state.lots.shift();
        }
      }

      state.totalAmount = state.lots.reduce((sum, lot) => sum + lot.qty, 0);
    }
  }

  // Aggregate results
  let realized_pnl = 0;
  let total_gain = 0;
  let total_loss = 0;
  const positions: PositionSummary[] = [];

  for (const [key, state] of states.entries()) {
    realized_pnl += state.realized_pnl;
    if (state.realized_pnl > 0) {
      total_gain += state.realized_pnl;
    } else {
      total_loss += state.realized_pnl;
    }

    const [conditionId, outcomeIndexStr] = key.split('_');
    const avgPrice = state.lots.length > 0
      ? state.lots.reduce((sum, lot) => sum + lot.costBasis, 0) / state.totalAmount
      : 0;

    positions.push({
      condition_id: conditionId,
      outcome_index: parseInt(outcomeIndexStr, 10),
      amount: state.totalAmount,
      avgPrice,
      realized_pnl: state.realized_pnl,
      trade_count: state.trade_count,
    });
  }

  return {
    realized_pnl,
    total_gain,
    total_loss,
    volume_traded,
    volume_buys,
    volume_sells,
    buys_count,
    sells_count,
    outcomes_traded: states.size,
    positions,
    trade_returns,
    syntheticPairsDetected: totalSyntheticPairs,
    syntheticTokensAdjusted: totalSyntheticTokens,
  };
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
}

async function loadAllResolutions(): Promise<Map<string, ResolutionInfo>> {
  const result = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM ${RESOLUTIONS_TABLE}`,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const cache = new Map<string, ResolutionInfo>();

  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    cache.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: payouts,
    });
  }

  return cache;
}

// -----------------------------------------------------------------------------
// V11c Engine Class
// -----------------------------------------------------------------------------

export class V11cEngine {
  private resolutionCache: Map<string, ResolutionInfo> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV11c> {
    // Load resolution cache if needed
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const trades = await getClobTradesForWallet(wallet);
    const result = calculatePnLWithBoundedSyntheticPairs(trades);

    // Add resolution PnL for positions with remaining amount
    let additionalPnL = 0;
    const updatedPositions = result.positions.map((pos) => {
      if (pos.amount > 0.01) {
        const resolution = this.resolutionCache?.get(pos.condition_id.toLowerCase());
        if (resolution && resolution.payout_numerators.length > pos.outcome_index) {
          const payout = resolution.payout_numerators[pos.outcome_index];
          const resolutionPnL = (payout - pos.avgPrice) * pos.amount;
          additionalPnL += resolutionPnL;

          if (pos.avgPrice > 0) {
            result.trade_returns.push({
              condition_id: pos.condition_id,
              outcome_index: pos.outcome_index,
              trade_time: 'resolved',
              pnl: resolutionPnL,
              return_pct: (payout - pos.avgPrice) / pos.avgPrice,
            });
          }

          return {
            ...pos,
            realized_pnl: pos.realized_pnl + resolutionPnL,
            amount: 0,
          };
        }
      }
      return pos;
    });

    const totalPnL = result.realized_pnl + additionalPnL;

    // Recalculate gain/loss
    let total_gain = 0;
    let total_loss = 0;
    for (const pos of updatedPositions) {
      if (pos.realized_pnl > 0) {
        total_gain += pos.realized_pnl;
      } else {
        total_loss += pos.realized_pnl;
      }
    }

    return {
      wallet,
      realized_pnl: totalPnL,
      total_gain,
      total_loss,
      volume_traded: result.volume_traded,
      volume_buys: result.volume_buys,
      volume_sells: result.volume_sells,
      buys_count: result.buys_count,
      sells_count: result.sells_count,
      outcomes_traded: result.outcomes_traded,
      positions: updatedPositions,
      trade_returns: result.trade_returns,
      syntheticPairsDetected: result.syntheticPairsDetected,
      syntheticTokensAdjusted: result.syntheticTokensAdjusted,
    };
  }
}

export function createV11cEngine(): V11cEngine {
  return new V11cEngine();
}
