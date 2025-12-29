/**
 * UI Activity PnL Engine V11b
 *
 * ============================================================================
 * V11b: V11 + SYNTHETIC PAIR COST BASIS ADJUSTMENT
 * Session: 2025-12-07
 * ============================================================================
 *
 * V11 underestimates profits because it doesn't account for "synthetic pairs":
 *   - BUY 17857 YES @ $0.56 ($10,000)
 *   - SELL 17857 NO @ $0.44 ($7,857) - "phantom sell" with no prior position
 *
 * V11 records cost basis = $0.56 (the BUY price only)
 * But the REAL cost is $0.56 - $0.44 = $0.12 per token
 *
 * V11b fixes this by:
 * 1. Detecting same-tx BUY outcome_A + SELL outcome_B patterns
 * 2. Adjusting the cost basis of the BUY by crediting the SELL proceeds
 *
 * This makes resolution PnL calculation accurate:
 *   - V11: profit = (1 - 0.56) × 17857 = $7,857
 *   - V11b: profit = (1 - 0.12) × 17857 = $15,714 ← Correct!
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

export interface WalletMetricsV11b {
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
  costBasisAdjustment: number;
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

interface PositionState {
  amount: number;
  avgPrice: number;
  totalBought: number;
  totalCostBasis: number; // Track total cost separately
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
// Data Loading - CLOB trades with tx_hash for pairing
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
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
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
// Synthetic Pair Detection
// -----------------------------------------------------------------------------

interface SyntheticPairAdjustment {
  condition_id: string;
  outcome_index: number; // The BUY outcome that gets the credit
  usdc_credit: number;   // USDC received from the phantom sell
}

/**
 * Detect synthetic pairs: same-tx BUY one outcome + SELL opposite outcome
 * Returns adjustments that should credit the BUY's cost basis
 */
function detectSyntheticPairs(trades: TradeEvent[]): SyntheticPairAdjustment[] {
  const adjustments: SyntheticPairAdjustment[] = [];

  // Group trades by tx_hash
  const tradesByTx = new Map<string, TradeEvent[]>();
  for (const t of trades) {
    if (!t.tx_hash) continue;
    const existing = tradesByTx.get(t.tx_hash) || [];
    existing.push(t);
    tradesByTx.set(t.tx_hash, existing);
  }

  // For each transaction with multiple trades
  for (const [txHash, txTrades] of tradesByTx.entries()) {
    if (txTrades.length < 2) continue;

    // Group by condition_id
    const tradesByCondition = new Map<string, TradeEvent[]>();
    for (const t of txTrades) {
      const key = t.condition_id.toLowerCase();
      const existing = tradesByCondition.get(key) || [];
      existing.push(t);
      tradesByCondition.set(key, existing);
    }

    // For each condition with multiple trades (potential synthetic pair)
    for (const [conditionId, condTrades] of tradesByCondition.entries()) {
      if (condTrades.length < 2) continue;

      const buys = condTrades.filter(t => t.side === 'buy');
      const sells = condTrades.filter(t => t.side === 'sell');

      if (buys.length === 0 || sells.length === 0) continue;

      // Check for phantom sells (sells on different outcome than buys)
      for (const sell of sells) {
        // Is there a buy on a DIFFERENT outcome in this same tx?
        const pairedBuy = buys.find(b => b.outcome_index !== sell.outcome_index);

        if (pairedBuy) {
          // This is a synthetic pair! The sell's USDC should credit the buy's cost basis
          adjustments.push({
            condition_id: conditionId,
            outcome_index: pairedBuy.outcome_index,
            usdc_credit: sell.usdc_notional,
          });
        }
      }
    }
  }

  return adjustments;
}

// -----------------------------------------------------------------------------
// Core Algorithm - WITH SYNTHETIC PAIR ADJUSTMENT
// -----------------------------------------------------------------------------

function calculatePnLWithSyntheticAdjustment(trades: TradeEvent[]): {
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
  costBasisAdjustment: number;
} {
  // Detect synthetic pairs FIRST
  const adjustments = detectSyntheticPairs(trades);

  // Build adjustment map: condition_outcome → total credit
  const adjustmentMap = new Map<string, number>();
  for (const adj of adjustments) {
    const key = `${adj.condition_id.toLowerCase()}_${adj.outcome_index}`;
    const existing = adjustmentMap.get(key) || 0;
    adjustmentMap.set(key, existing + adj.usdc_credit);
  }

  // Sort by time
  trades.sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  const states = new Map<string, PositionState>();
  const getKey = (cid: string, idx: number) => `${cid.toLowerCase()}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let buys_count = 0;
  let sells_count = 0;
  let totalCostBasisAdjustment = 0;

  const trade_returns: TradeReturn[] = [];

  for (const trade of trades) {
    const key = getKey(trade.condition_id, trade.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        amount: 0,
        avgPrice: 0,
        totalBought: 0,
        totalCostBasis: 0,
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
        // Standard avgPrice calculation
        const numerator = state.avgPrice * state.amount + price * trade.qty_tokens;
        const denominator = state.amount + trade.qty_tokens;
        state.avgPrice = numerator / denominator;
        state.amount += trade.qty_tokens;
        state.totalBought += trade.qty_tokens;
        state.totalCostBasis += trade.usdc_notional;
      }
    } else if (trade.side === 'sell') {
      sells_count++;
      volume_sells += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      // Only realize PnL if we had a position (skip phantom sells)
      const adjustedAmount = Math.min(trade.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (price - state.avgPrice);
        state.realized_pnl += deltaPnL;
        state.amount -= adjustedAmount;

        const return_pct = (price - state.avgPrice) / state.avgPrice;
        trade_returns.push({
          condition_id: trade.condition_id,
          outcome_index: trade.outcome_index,
          trade_time: trade.trade_time,
          pnl: deltaPnL,
          return_pct,
        });
      }
    }
  }

  // NOW apply synthetic pair adjustments to cost basis
  for (const [key, credit] of adjustmentMap.entries()) {
    const state = states.get(key);
    if (state && state.totalBought > 0) {
      // Reduce avgPrice by the credit per token
      const creditPerToken = credit / state.totalBought;
      const oldAvgPrice = state.avgPrice;
      state.avgPrice = Math.max(0, state.avgPrice - creditPerToken);
      totalCostBasisAdjustment += credit;

      // Log significant adjustments
      // console.log(`[V11b] Adjusted ${key}: avgPrice ${oldAvgPrice.toFixed(4)} → ${state.avgPrice.toFixed(4)} (credit: $${credit.toFixed(2)})`);
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
    positions.push({
      condition_id: conditionId,
      outcome_index: parseInt(outcomeIndexStr, 10),
      amount: state.amount,
      avgPrice: state.avgPrice,
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
    syntheticPairsDetected: adjustments.length,
    costBasisAdjustment: totalCostBasisAdjustment,
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
// V11b Engine Class
// -----------------------------------------------------------------------------

export class V11bEngine {
  private resolutionCache: Map<string, ResolutionInfo> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV11b> {
    // Load resolution cache if needed
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const trades = await getClobTradesForWallet(wallet);
    const result = calculatePnLWithSyntheticAdjustment(trades);

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
      costBasisAdjustment: result.costBasisAdjustment,
    };
  }
}

export function createV11bEngine(): V11bEngine {
  return new V11bEngine();
}
