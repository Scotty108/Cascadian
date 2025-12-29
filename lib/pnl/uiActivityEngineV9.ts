/**
 * UI Activity PnL Engine V9
 *
 * ============================================================================
 * V9: MATCHES POLYMARKET SUBGRAPH LOGIC EXACTLY
 * Session: 2025-12-02
 * ============================================================================
 *
 * Based on Polymarket's actual subgraph code:
 * https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/utils/
 *
 * KEY DIFFERENCES from V8:
 * 1. NO CTF events (no splits, merges, redemptions)
 * 2. ONLY CLOB order book trades
 * 3. Price rounded to cents before calculation
 * 4. Sell amount capped at tracked position (adjustedAmount logic)
 *
 * Polymarket's formula:
 *   On BUY:  avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 *   On SELL: deltaPnL = adjustedAmount * (price - avgPrice)
 *            where adjustedAmount = min(sellAmount, trackedAmount)
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV9 {
  wallet: string;

  // Core PnL (matches Polymarket subgraph)
  realized_pnl: number;

  // Breakdown for Omega/Sharpe calculations
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

  // Per-trade returns (for ratio calculations)
  trade_returns: TradeReturn[];
}

export interface TradeReturn {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  pnl: number;
  return_pct: number; // (price - avgPrice) / avgPrice
}

interface ClobFill {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  side: 'buy' | 'sell';
  qty_tokens: number;
  price: number; // Already in decimal (e.g., 0.52)
  usdc_notional: number;
}

interface OutcomeState {
  amount: number;       // Current position size (shares)
  avgPrice: number;     // Weighted average cost basis
  totalBought: number;  // Cumulative shares bought
  realized_pnl: number; // Running realized PnL
}

// -----------------------------------------------------------------------------
// Price Rounding (matches Polymarket UI)
// -----------------------------------------------------------------------------

/**
 * Round price to cents (2 decimal places) before calculations.
 * John from GoldSky confirmed this causes significant differences.
 */
function roundToCents(price: number): number {
  return Math.round(price * 100) / 100;
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

async function getClobFillsForWallet(wallet: string): Promise<ClobFill[]> {
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
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
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
// Core Algorithm - Matches Polymarket Subgraph EXACTLY
// -----------------------------------------------------------------------------

function calculatePnLSubgraphStyle(fills: ClobFill[]): {
  realized_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  buys_count: number;
  sells_count: number;
  outcomes_traded: number;
  trade_returns: TradeReturn[];
} {
  // Sort by time
  fills.sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  const states = new Map<string, OutcomeState>();
  const getKey = (cid: string, idx: number) => `${cid.toLowerCase()}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let buys_count = 0;
  let sells_count = 0;

  const trade_returns: TradeReturn[] = [];

  for (const fill of fills) {
    const key = getKey(fill.condition_id, fill.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        amount: 0,
        avgPrice: 0,
        totalBought: 0,
        realized_pnl: 0,
      });
    }

    const state = states.get(key)!;

    // Round price to cents (per GoldSky's rounding insight)
    const price = roundToCents(fill.price);

    if (fill.side === 'buy') {
      // =====================================================================
      // BUY LOGIC - from updateUserPositionWithBuy.ts
      // =====================================================================
      // avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
      // amount += buyAmount
      // totalBought += buyAmount
      // =====================================================================

      buys_count++;
      volume_buys += fill.usdc_notional;
      volume_traded += fill.usdc_notional;

      if (fill.qty_tokens > 0) {
        const numerator = state.avgPrice * state.amount + price * fill.qty_tokens;
        const denominator = state.amount + fill.qty_tokens;
        state.avgPrice = numerator / denominator;
        state.amount += fill.qty_tokens;
        state.totalBought += fill.qty_tokens;
      }
    } else if (fill.side === 'sell') {
      // =====================================================================
      // SELL LOGIC - from updateUserPositionWithSell.ts
      // =====================================================================
      // KEY: "use userPosition amount if the amount is greater than the
      //       userPosition amount - that means the user obtained tokens
      //       outside of what we track and we don't want to give them PnL
      //       for the extra"
      //
      // adjustedAmount = min(sellAmount, userPosition.amount)
      // deltaPnL = adjustedAmount * (price - avgPrice)
      // realizedPnl += deltaPnL
      // amount -= adjustedAmount
      // =====================================================================

      sells_count++;
      volume_sells += fill.usdc_notional;
      volume_traded += fill.usdc_notional;

      // Cap at tracked position (THE KEY INSIGHT)
      const adjustedAmount = Math.min(fill.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (price - state.avgPrice);
        state.realized_pnl += deltaPnL;
        state.amount -= adjustedAmount;

        // Track individual trade return for Sharpe/Sortino/Omega
        const return_pct = (price - state.avgPrice) / state.avgPrice;
        trade_returns.push({
          condition_id: fill.condition_id,
          outcome_index: fill.outcome_index,
          trade_time: fill.trade_time,
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

  for (const state of states.values()) {
    realized_pnl += state.realized_pnl;
    if (state.realized_pnl > 0) {
      total_gain += state.realized_pnl;
    } else {
      total_loss += state.realized_pnl;
    }
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
    trade_returns,
  };
}

// -----------------------------------------------------------------------------
// V9 Engine Class
// -----------------------------------------------------------------------------

export class V9Engine {
  /**
   * Compute PnL for a single wallet using Polymarket subgraph logic.
   *
   * NO CTF events. NO redemptions. ONLY order book trades.
   */
  async compute(wallet: string): Promise<WalletMetricsV9> {
    const fills = await getClobFillsForWallet(wallet);
    const result = calculatePnLSubgraphStyle(fills);

    return {
      wallet,
      realized_pnl: result.realized_pnl,
      total_gain: result.total_gain,
      total_loss: result.total_loss,
      volume_traded: result.volume_traded,
      volume_buys: result.volume_buys,
      volume_sells: result.volume_sells,
      buys_count: result.buys_count,
      sells_count: result.sells_count,
      outcomes_traded: result.outcomes_traded,
      trade_returns: result.trade_returns,
    };
  }

  /**
   * Compute PnL for multiple wallets.
   */
  async computeBatch(
    wallets: string[],
    batchSize: number = 5,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WalletMetricsV9[]> {
    const results: WalletMetricsV9[] = [];

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
      results.push(...(batchResults.filter((r) => r !== null) as WalletMetricsV9[]));

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

export function createV9Engine(): V9Engine {
  return new V9Engine();
}

// -----------------------------------------------------------------------------
// Utility: Calculate Omega Ratio from trade returns
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

  if (losses === 0) return Infinity;
  return gains / losses;
}

/**
 * Calculate Sharpe Ratio from trade returns.
 * sharpe = mean(returns) / std(returns)
 */
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

/**
 * Calculate Sortino Ratio from trade returns.
 * sortino = mean(returns) / downside_std(returns)
 */
export function calculateSortinoRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  // Only negative returns for downside deviation
  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return Infinity;

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return Infinity;
  return mean / downsideStd;
}
