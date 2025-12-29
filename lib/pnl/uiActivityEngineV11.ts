/**
 * UI Activity PnL Engine V11
 *
 * ============================================================================
 * V11: PRICE ROUNDING + COMPREHENSIVE PnL TRACKING
 * Session: 2025-12-02
 * ============================================================================
 *
 * Based on GoldSky's feedback:
 * 1. Round prices to cents (2 decimal places) BEFORE calculations
 * 2. Track ALL PnL sources: CLOB buys/sells, CTF events, resolutions
 *
 * Key insight from John at GoldSky:
 * "Price rounding causes significant differences"
 *
 * Formula (matches Polymarket subgraph):
 *   BUY:  avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 *   SELL: deltaPnL = min(sellAmount, amount) * (price - avgPrice)
 *
 * Where price is ROUNDED TO CENTS before calculation.
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

export interface WalletMetricsV11 {
  wallet: string;

  // Core PnL
  realized_pnl: number;
  total_gain: number;
  total_loss: number;

  // Volume
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;

  // Counts
  buys_count: number;
  sells_count: number;
  outcomes_traded: number;

  // Position detail for debugging
  positions: PositionSummary[];

  // Trade returns for Omega/Sharpe/Sortino
  trade_returns: TradeReturn[];
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
}

interface PositionState {
  amount: number;
  avgPrice: number;
  totalBought: number;
  realized_pnl: number;
  trade_count: number;
}

// -----------------------------------------------------------------------------
// Price Rounding - THE KEY FIX
// -----------------------------------------------------------------------------

/**
 * Round price to cents (2 decimal places) BEFORE any calculation.
 * This is critical for matching Polymarket's numbers.
 */
function roundToCents(price: number): number {
  return Math.round(price * 100) / 100;
}

// -----------------------------------------------------------------------------
// Data Loading - CLOB trades only (matching V9/subgraph)
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
      fills.usdc_notional
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
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
  }));
}

// -----------------------------------------------------------------------------
// Core Algorithm - WITH PRICE ROUNDING
// -----------------------------------------------------------------------------

function calculatePnLWithRounding(trades: TradeEvent[]): {
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
} {
  // Sort by time
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
        amount: 0,
        avgPrice: 0,
        totalBought: 0,
        realized_pnl: 0,
        trade_count: 0,
      });
    }

    const state = states.get(key)!;
    state.trade_count++;

    // *** THE KEY FIX: Round price to cents ***
    const price = roundToCents(trade.price);

    if (trade.side === 'buy') {
      // BUY LOGIC (subgraph formula)
      buys_count++;
      volume_buys += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      if (trade.qty_tokens > 0) {
        const numerator = state.avgPrice * state.amount + price * trade.qty_tokens;
        const denominator = state.amount + trade.qty_tokens;
        state.avgPrice = numerator / denominator;
        state.amount += trade.qty_tokens;
        state.totalBought += trade.qty_tokens;
      }
    } else if (trade.side === 'sell') {
      // SELL LOGIC (subgraph formula with adjustedAmount)
      sells_count++;
      volume_sells += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      // Cap at tracked position
      const adjustedAmount = Math.min(trade.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (price - state.avgPrice);
        state.realized_pnl += deltaPnL;
        state.amount -= adjustedAmount;

        // Track trade return
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
  };
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
}

let globalResolutionCache: Map<string, ResolutionInfo> | null = null;

async function loadAllResolutions(): Promise<Map<string, ResolutionInfo>> {
  console.log('[V11] Loading all resolutions into cache...');
  const start = Date.now();

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

  const elapsed = Date.now() - start;
  console.log(`[V11] Loaded ${cache.size} resolutions in ${elapsed}ms`);

  return cache;
}

// -----------------------------------------------------------------------------
// V11 Engine Class
// -----------------------------------------------------------------------------

export class V11Engine {
  private resolutionCache: Map<string, ResolutionInfo> | null = null;

  /**
   * Compute PnL for a single wallet.
   * Uses price rounding to match Polymarket's calculation.
   * INCLUDES resolution PnL for positions held to market close.
   */
  async compute(wallet: string): Promise<WalletMetricsV11> {
    // Load resolution cache if needed
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const trades = await getClobTradesForWallet(wallet);
    const result = calculatePnLWithRounding(trades);

    // Add resolution PnL for positions with remaining amount
    let additionalPnL = 0;
    const updatedPositions = result.positions.map((pos) => {
      if (pos.amount > 0.01) {
        const resolution = this.resolutionCache?.get(pos.condition_id.toLowerCase());
        if (resolution && resolution.payout_numerators.length > pos.outcome_index) {
          const payout = resolution.payout_numerators[pos.outcome_index];
          const resolutionPnL = (payout - pos.avgPrice) * pos.amount;
          additionalPnL += resolutionPnL;

          // Add to trade returns for ratio calculation
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
            amount: 0, // Position closed by resolution
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
    };
  }

  /**
   * Compute for a specific position to compare against API ground truth.
   */
  async computePosition(
    wallet: string,
    conditionId: string,
    outcomeIndex: number
  ): Promise<PositionSummary | null> {
    const trades = await getClobTradesForWallet(wallet);

    // Filter to this position only
    const cleanConditionId = conditionId.replace(/^0x/, '').toLowerCase();
    const positionTrades = trades.filter(
      (t) =>
        t.condition_id.toLowerCase() === cleanConditionId &&
        t.outcome_index === outcomeIndex
    );

    if (positionTrades.length === 0) {
      return null;
    }

    // Calculate just this position
    const result = calculatePnLWithRounding(positionTrades);

    return result.positions[0] || null;
  }

  /**
   * Compute PnL for multiple wallets.
   */
  async computeBatch(
    wallets: string[],
    batchSize: number = 5,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WalletMetricsV11[]> {
    const results: WalletMetricsV11[] = [];

    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((wallet) =>
          this.compute(wallet).catch((err) => {
            console.error(`Error for ${wallet}: ${err.message}`);
            return null;
          })
        )
      );
      results.push(...(batchResults.filter((r) => r !== null) as WalletMetricsV11[]));

      if (onProgress) {
        onProgress(Math.min(i + batchSize, wallets.length), wallets.length);
      }
    }

    return results;
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

export function createV11Engine(): V11Engine {
  return new V11Engine();
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

export function calculateOmegaRatio(
  trade_returns: TradeReturn[],
  threshold: number = 0
): number {
  if (trade_returns.length === 0) return 0;

  let gains = 0;
  let losses = 0;

  for (const tr of trade_returns) {
    const excess = tr.return_pct - threshold;
    if (excess > 0) {
      gains += excess;
    } else {
      losses += Math.abs(excess);
    }
  }

  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function calculateSharpeRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;
  return mean / std;
}

export function calculateSortinoRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return mean > 0 ? Infinity : 0;

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return mean > 0 ? Infinity : 0;
  return mean / downsideStd;
}
