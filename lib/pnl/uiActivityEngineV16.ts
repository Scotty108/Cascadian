/**
 * UI Activity PnL Engine V16 - CLOB-Only with Aggregate NegRisk Pairing
 *
 * ============================================================================
 * V16: FIXES NEGRISK PAIRING BY AGGREGATING AT TIMESTAMP LEVEL
 * Session: 2025-12-03
 * ============================================================================
 *
 * V15 BUG: Paired trades by exact 1:1 qty match, missing fragmented fills
 *
 * V16 FIX: Aggregate by (condition_id, timestamp) then pair by net quantity
 * - Group all trades by (condition_id, trade_time)
 * - Calculate net buy/sell qty per outcome
 * - If (buy on idx=A) + (sell on idx=B) at same time → NegRisk acquisition
 *   → Only track the NET position change on the bought outcome
 *   → Ignore the sell leg entirely (it's just the minting mechanism)
 *
 * Example:
 *   At timestamp T1:
 *     buy 5000 idx=1 @ avg $0.84
 *     sell 411+4500+88 = 5000 idx=0 @ avg $0.16
 *   → Net: +5000 idx=1 at cost of $4200 (= 5000 * 0.84)
 *   → The idx=0 sells are NOT short positions, they're the NegRisk mechanism
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Short Mode Configuration
// -----------------------------------------------------------------------------

/**
 * ShortMode controls how the engine handles sells that exceed long positions:
 *
 * - 'full_shorts': Allow negative positions (true shorts). Sells before buys
 *   create negative position. At resolution, negative position on winning
 *   outcome creates a loss.
 *
 * - 'no_shorts': Do not allow negative positions. When selling, only realize
 *   PnL on min(qty_to_sell, current_long_position). Excess sell quantity is
 *   ignored. Position never goes below zero.
 *
 * - 'clamped_shorts': Allow position to go negative during trading, but at
 *   resolution treat any negative position as zero for payout calculation.
 *   You still realize PnL from round-trip trades, but leftover negative
 *   quantity doesn't owe $1 at resolution.
 */
export type ShortMode = 'full_shorts' | 'no_shorts' | 'clamped_shorts';

export interface V16Options {
  shortMode?: ShortMode;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV16 {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  total_trades: number;
  positions_count: number;
  markets_traded: number;
  clob_trades: number;
  negrisk_acquisitions: number;
  negrisk_sell_legs_filtered: number;
  resolutions: number;
  positions: PositionSummaryV16[];
  trade_returns: TradeReturnV16[];
  by_category: CategoryMetrics[];
}

export interface PositionSummaryV16 {
  condition_id: string;
  outcome_index: number;
  category: string;
  current_amount: number;
  avg_cost_basis: number;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: boolean;
  resolution_payout: number | null;
}

export interface TradeReturnV16 {
  condition_id: string;
  outcome_index: number;
  category: string;
  trade_time: string;
  source: TradeSource;
  side: 'buy' | 'sell' | 'resolution';
  qty: number;
  price: number;
  pnl: number;
  return_pct: number;
  cost_basis: number;
}

export interface CategoryMetrics {
  category: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  trades_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_return: number;
  total_cost_basis: number;
  roi: number;
}

type TradeSource = 'clob' | 'negrisk' | 'resolution';

interface TradeEntry {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  source: TradeSource;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  category: string;
}

interface Resolution {
  condition_id: string;
  payout_numerators: number[];
  resolved_at: string | null;
}

// -----------------------------------------------------------------------------
// CORE LEDGER STATE MACHINE - With ShortMode support
// -----------------------------------------------------------------------------

interface LedgerState {
  position: number;
  totalCost: number;
  realized_pnl: number;
  trade_count: number;
  category: string;
}

/**
 * Apply a trade to the ledger state.
 *
 * @param shortMode Controls how sells beyond long position are handled:
 *   - 'full_shorts': Allow negative positions (true shorts)
 *   - 'no_shorts': Clamp sells to current long position, ignore excess
 *   - 'clamped_shorts': Allow negative positions during trading (same as full_shorts here)
 */
function applyTrade(
  state: LedgerState,
  side: 'buy' | 'sell',
  qty: number,
  price: number,
  shortMode: ShortMode = 'full_shorts'
): { pnl: number; closedQty: number; openedQty: number } {
  let pnl = 0;
  let closedQty = 0;
  let openedQty = 0;
  let remainingQty = qty;

  if (side === 'buy') {
    // For 'no_shorts' mode, we never have negative positions, so skip short-closing logic
    if (shortMode !== 'no_shorts' && state.position < 0 && remainingQty > 0) {
      const shortQty = -state.position;
      const closeQty = Math.min(remainingQty, shortQty);
      const avgShortPrice = state.totalCost / state.position;
      const closePnl = (avgShortPrice - price) * closeQty;
      pnl += closePnl;
      state.realized_pnl += closePnl;
      state.position += closeQty;
      state.totalCost += avgShortPrice * closeQty;
      closedQty = closeQty;
      remainingQty -= closeQty;
    }
    if (remainingQty > 0) {
      state.position += remainingQty;
      state.totalCost += remainingQty * price;
      openedQty = remainingQty;
    }
  } else {
    // SELL logic
    if (state.position > 0 && remainingQty > 0) {
      const longQty = state.position;
      const closeQty = Math.min(remainingQty, longQty);
      const avgLongPrice = state.totalCost / state.position;
      const closePnl = (price - avgLongPrice) * closeQty;
      pnl += closePnl;
      state.realized_pnl += closePnl;
      state.position -= closeQty;
      state.totalCost -= avgLongPrice * closeQty;
      closedQty = closeQty;
      remainingQty -= closeQty;
    }

    // Handle excess sell (beyond long position)
    if (remainingQty > 0) {
      if (shortMode === 'no_shorts') {
        // In no_shorts mode, ignore any sell quantity beyond current long position
        // Position stays at 0, no short is opened
        // openedQty stays 0 (we didn't open a short)
      } else {
        // 'full_shorts' or 'clamped_shorts': allow negative position
        state.position -= remainingQty;
        state.totalCost -= remainingQty * price;
        openedQty = remainingQty;
      }
    }
  }

  return { pnl, closedQty, openedQty };
}

/**
 * Settle position at resolution.
 *
 * @param shortMode Controls how negative positions are handled at resolution:
 *   - 'full_shorts': Negative position owes payout (loss on winning outcome)
 *   - 'no_shorts': Should never have negative positions
 *   - 'clamped_shorts': Treat negative positions as zero (no payout owed)
 */
function settleAtResolution(
  state: LedgerState,
  payout: number,
  shortMode: ShortMode = 'full_shorts'
): number {
  if (Math.abs(state.position) < 0.001) return 0;

  let pnl = 0;

  if (state.position > 0) {
    // Long position: receive payout, lose cost basis
    const avgPrice = state.totalCost / state.position;
    pnl = (payout - avgPrice) * state.position;
  } else {
    // Short position handling
    if (shortMode === 'clamped_shorts') {
      // In clamped mode, treat negative position as zero at resolution
      // No payout is owed - the short "disappears"
      pnl = 0;
    } else if (shortMode === 'no_shorts') {
      // Should never reach here, but just in case
      pnl = 0;
    } else {
      // 'full_shorts': short position owes payout
      const shortQty = -state.position;
      const avgPrice = -state.totalCost / shortQty;
      pnl = (avgPrice - payout) * shortQty;
    }
  }

  state.realized_pnl += pnl;
  state.position = 0;
  state.totalCost = 0;

  return pnl;
}

// -----------------------------------------------------------------------------
// Data Loading with Aggregate NegRisk Detection
// -----------------------------------------------------------------------------

interface RawTrade {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  side: 'buy' | 'sell';
  qty: number;
  usdc: number;
  category: string;
}

async function getClobTrades(wallet: string): Promise<{
  entries: TradeEntry[];
  negriskSellLegsFiltered: number;
}> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_amount,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      d.trade_time,
      d.side,
      d.qty_tokens as qty,
      d.usdc_amount as usdc,
      COALESCE(m.category, 'Other') as category
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time, m.condition_id, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const rawTrades: RawTrade[] = rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    trade_time: r.trade_time,
    side: r.side as 'buy' | 'sell',
    qty: Math.abs(Number(r.qty)),
    usdc: Math.abs(Number(r.usdc)),
    category: r.category || 'Other',
  }));

  // Group by (condition_id, trade_time)
  const groups = new Map<string, RawTrade[]>();
  for (const t of rawTrades) {
    const key = `${t.condition_id}_${t.trade_time}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(t);
  }

  const entries: TradeEntry[] = [];
  let negriskSellLegsFiltered = 0;

  for (const [, trades] of groups) {
    const condition_id = trades[0].condition_id;
    const trade_time = trades[0].trade_time;
    const category = trades[0].category;

    // Calculate net qty per (outcome, side)
    const stats = new Map<string, { qty: number; usdc: number }>();
    for (const t of trades) {
      const key = `${t.outcome_index}_${t.side}`;
      if (!stats.has(key)) {
        stats.set(key, { qty: 0, usdc: 0 });
      }
      stats.get(key)!.qty += t.qty;
      stats.get(key)!.usdc += t.usdc;
    }

    // Get buy/sell totals per outcome
    const idx0Buy = stats.get('0_buy')?.qty ?? 0;
    const idx0Sell = stats.get('0_sell')?.qty ?? 0;
    const idx1Buy = stats.get('1_buy')?.qty ?? 0;
    const idx1Sell = stats.get('1_sell')?.qty ?? 0;

    const idx0BuyUsdc = stats.get('0_buy')?.usdc ?? 0;
    const idx0SellUsdc = stats.get('0_sell')?.usdc ?? 0;
    const idx1BuyUsdc = stats.get('1_buy')?.usdc ?? 0;
    const idx1SellUsdc = stats.get('1_sell')?.usdc ?? 0;

    // Detect NegRisk patterns:
    // Pattern 1: Buy idx=1 + Sell idx=0 → acquiring idx=1 via NegRisk
    // Pattern 2: Buy idx=0 + Sell idx=1 → acquiring idx=0 via NegRisk

    // Handle Pattern 1: Buy idx=1 + Sell idx=0
    if (idx1Buy > 0 && idx0Sell > 0) {
      const pairedQty = Math.min(idx1Buy, idx0Sell);
      negriskSellLegsFiltered += pairedQty;

      // The paired portion is a NegRisk acquisition - only track the buy
      // Avg price for paired buys
      const pairedBuyPrice = idx1BuyUsdc / idx1Buy;
      entries.push({
        condition_id,
        outcome_index: 1,
        trade_time,
        source: 'clob',
        side: 'buy',
        qty: idx1Buy, // Full buy qty at the buy price
        price: pairedBuyPrice,
        category,
      });

      // If there's excess sell on idx=0 (more sells than buys) → real short
      if (idx0Sell > idx1Buy) {
        const excessSellQty = idx0Sell - idx1Buy;
        const avgSellPrice = idx0SellUsdc / idx0Sell;
        entries.push({
          condition_id,
          outcome_index: 0,
          trade_time,
          source: 'clob',
          side: 'sell',
          qty: excessSellQty,
          price: avgSellPrice,
          category,
        });
      }
    }
    // Handle Pattern 2: Buy idx=0 + Sell idx=1
    else if (idx0Buy > 0 && idx1Sell > 0) {
      const pairedQty = Math.min(idx0Buy, idx1Sell);
      negriskSellLegsFiltered += pairedQty;

      const pairedBuyPrice = idx0BuyUsdc / idx0Buy;
      entries.push({
        condition_id,
        outcome_index: 0,
        trade_time,
        source: 'clob',
        side: 'buy',
        qty: idx0Buy,
        price: pairedBuyPrice,
        category,
      });

      if (idx1Sell > idx0Buy) {
        const excessSellQty = idx1Sell - idx0Buy;
        const avgSellPrice = idx1SellUsdc / idx1Sell;
        entries.push({
          condition_id,
          outcome_index: 1,
          trade_time,
          source: 'clob',
          side: 'sell',
          qty: excessSellQty,
          price: avgSellPrice,
          category,
        });
      }
    }
    // No pairing - output all trades as-is
    else {
      for (const [key, val] of stats) {
        const [outcomeStr, side] = key.split('_');
        const outcomeIndex = parseInt(outcomeStr, 10);
        const avgPrice = val.usdc / val.qty;

        entries.push({
          condition_id,
          outcome_index: outcomeIndex,
          trade_time,
          source: 'clob',
          side: side as 'buy' | 'sell',
          qty: val.qty,
          price: avgPrice,
          category,
        });
      }
    }
  }

  // Sort by time
  entries.sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  return { entries, negriskSellLegsFiltered };
}

async function loadAllResolutions(): Promise<Map<string, Resolution>> {
  const query = `
    SELECT condition_id, payout_numerators, resolved_at
    FROM pm_condition_resolutions
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, Resolution>();
  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    map.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id.toLowerCase(),
      payout_numerators: payouts,
      resolved_at: r.resolved_at,
    });
  }

  return map;
}

async function getNegriskCount(wallet: string): Promise<number> {
  const query = `
    SELECT count() as cnt
    FROM vw_negrisk_conversions
    WHERE lower(wallet) = lower('${wallet}')
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    return rows[0]?.cnt ?? 0;
  } catch {
    return 0;
  }
}

// -----------------------------------------------------------------------------
// V16 Engine
// -----------------------------------------------------------------------------

class V16Engine {
  private resolutionCache: Map<string, Resolution> | null = null;
  private shortMode: ShortMode;

  constructor(opts: V16Options = {}) {
    this.shortMode = opts.shortMode ?? 'full_shorts';
  }

  async compute(wallet: string): Promise<WalletMetricsV16> {
    const [clobResult, negriskCount] = await Promise.all([
      getClobTrades(wallet),
      getNegriskCount(wallet),
    ]);

    const allEntries = clobResult.entries;
    const negriskSellLegsFiltered = clobResult.negriskSellLegsFiltered;

    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const states = new Map<string, LedgerState>();
    const trade_returns: TradeReturnV16[] = [];

    let clob_trades = 0;
    let volume_buys = 0;
    let volume_sells = 0;

    for (const entry of allEntries) {
      const key = `${entry.condition_id}_${entry.outcome_index}`;

      if (!states.has(key)) {
        states.set(key, {
          position: 0,
          totalCost: 0,
          realized_pnl: 0,
          trade_count: 0,
          category: entry.category,
        });
      }

      const state = states.get(key)!;
      state.trade_count++;
      clob_trades++;

      const tradeResult = applyTrade(state, entry.side, entry.qty, entry.price, this.shortMode);

      const tradeValue = entry.qty * entry.price;
      if (entry.side === 'buy') {
        volume_buys += tradeValue;
      } else {
        volume_sells += tradeValue;
      }

      trade_returns.push({
        condition_id: entry.condition_id,
        outcome_index: entry.outcome_index,
        category: entry.category,
        trade_time: entry.trade_time,
        source: entry.source,
        side: entry.side,
        qty: entry.qty,
        price: entry.price,
        pnl: tradeResult.pnl,
        return_pct:
          tradeResult.closedQty > 0 && entry.price > 0
            ? tradeResult.pnl / (tradeResult.closedQty * entry.price)
            : 0,
        cost_basis: tradeValue,
      });
    }

    let resolutions = 0;
    for (const [key, state] of states.entries()) {
      if (Math.abs(state.position) > 0.001) {
        const [conditionId, outcomeStr] = key.split('_');
        const outcomeIndex = parseInt(outcomeStr, 10);
        const resolution = this.resolutionCache?.get(conditionId);

        if (resolution && resolution.payout_numerators.length > outcomeIndex) {
          const payout = resolution.payout_numerators[outcomeIndex];
          const prePosition = state.position;
          const resPnl = settleAtResolution(state, payout, this.shortMode);

          resolutions++;

          trade_returns.push({
            condition_id: conditionId,
            outcome_index: outcomeIndex,
            category: state.category,
            trade_time: resolution.resolved_at || 'resolved',
            source: 'resolution',
            side: 'resolution',
            qty: Math.abs(prePosition),
            price: payout,
            pnl: resPnl,
            return_pct: 0,
            cost_basis: 0,
          });
        }
      }
    }

    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    const positions: PositionSummaryV16[] = [];
    const marketsSet = new Set<string>();

    for (const [key, state] of states.entries()) {
      const [conditionId, outcomeStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeStr, 10);
      marketsSet.add(conditionId);

      realized_pnl += state.realized_pnl;
      if (state.realized_pnl > 0) {
        total_gain += state.realized_pnl;
      } else {
        total_loss += state.realized_pnl;
      }

      let posUnrealized = 0;
      const resolution = this.resolutionCache?.get(conditionId);
      const isResolved = !!resolution;

      if (Math.abs(state.position) > 0.001 && !isResolved) {
        const currentPrice = 0.5;
        if (state.position > 0) {
          const avgCost = state.totalCost / state.position;
          posUnrealized = state.position * (currentPrice - avgCost);
        } else {
          const shortQty = -state.position;
          const avgPrice = -state.totalCost / shortQty;
          posUnrealized = shortQty * (avgPrice - currentPrice);
        }
        unrealized_pnl += posUnrealized;
      }

      positions.push({
        condition_id: conditionId,
        outcome_index: outcomeIndex,
        category: state.category,
        current_amount: state.position,
        avg_cost_basis:
          state.position !== 0 ? Math.abs(state.totalCost / state.position) : 0,
        realized_pnl: state.realized_pnl,
        unrealized_pnl: posUnrealized,
        is_resolved: isResolved,
        resolution_payout: resolution?.payout_numerators[outcomeIndex] ?? null,
      });
    }

    const by_category = this.calculateCategoryMetrics(trade_returns);

    return {
      wallet,
      realized_pnl,
      unrealized_pnl,
      total_pnl: realized_pnl + unrealized_pnl,
      total_gain,
      total_loss,
      volume_traded: volume_buys + volume_sells,
      volume_buys,
      volume_sells,
      total_trades: allEntries.length,
      positions_count: positions.length,
      markets_traded: marketsSet.size,
      clob_trades,
      negrisk_acquisitions: negriskCount,
      negrisk_sell_legs_filtered: negriskSellLegsFiltered,
      resolutions,
      positions,
      trade_returns,
      by_category,
    };
  }

  private calculateCategoryMetrics(
    trade_returns: TradeReturnV16[]
  ): CategoryMetrics[] {
    const categoryMap = new Map<string, TradeReturnV16[]>();
    for (const tr of trade_returns) {
      if (!categoryMap.has(tr.category)) {
        categoryMap.set(tr.category, []);
      }
      categoryMap.get(tr.category)!.push(tr);
    }

    const result: CategoryMetrics[] = [];

    for (const [category, trades] of categoryMap.entries()) {
      const pnlTrades = trades.filter((t) => t.side !== 'buy');
      const realized_pnl = pnlTrades.reduce((s, t) => s + t.pnl, 0);
      const wins = pnlTrades.filter((t) => t.pnl > 0);
      const losses = pnlTrades.filter((t) => t.pnl < 0);
      const total_cost = trades
        .filter((t) => t.side === 'buy')
        .reduce((s, t) => s + t.cost_basis, 0);

      result.push({
        category,
        realized_pnl,
        unrealized_pnl: 0,
        total_pnl: realized_pnl,
        trades_count: trades.length,
        win_count: wins.length,
        loss_count: losses.length,
        win_rate: pnlTrades.length > 0 ? wins.length / pnlTrades.length : 0,
        avg_return: pnlTrades.length > 0 ? realized_pnl / pnlTrades.length : 0,
        total_cost_basis: total_cost,
        roi: total_cost > 0 ? realized_pnl / total_cost : 0,
      });
    }

    return result.sort((a, b) => b.realized_pnl - a.realized_pnl);
  }
}

export function createV16Engine(opts: V16Options = {}): V16Engine {
  return new V16Engine(opts);
}

// -----------------------------------------------------------------------------
// Cross-Timestamp NegRisk Pairing (Experimental)
// -----------------------------------------------------------------------------

/**
 * Debug stats returned from cross-timestamp NegRisk pairing
 */
export interface CrossTimestampNegRiskStats {
  totalIdx0Sell: number;
  totalIdx1Buy: number;
  pairedQty: number;
  unpairedIdx0: number;
  unpairedIdx1: number;
  pairsFound: number;
}

/**
 * Result from inferCrossTimestampNegRiskPairs
 */
export interface CrossTimestampPairingResult {
  pairedIds: Set<string>;
  debugStats: CrossTimestampNegRiskStats;
}

interface CandidateTrade {
  id: string;
  timestamp: number;
  qty: number;
  remainingQty: number;
}

/**
 * Infers cross-timestamp NegRisk pairs within a time window W.
 *
 * Hypothesis: Polymarket pairs NegRisk legs across time (not just same timestamp).
 * When user buys outcome A via NegRisk, they sell outcome B, but these may occur
 * at slightly different timestamps due to order book fragmentation.
 *
 * Algorithm:
 * 1. Sort trades by timestamp
 * 2. Maintain a rolling queue of idx=1 buy candidates (potential NegRisk buys)
 * 3. When we see an idx=0 sell, check if there's an idx=1 buy within W seconds
 * 4. If found, pair them and mark both as NegRisk legs
 *
 * @param trades Raw trades for a SINGLE condition_id
 * @param windowSec Time window in seconds for cross-timestamp pairing
 * @returns Paired trade IDs and debug statistics
 */
export function inferCrossTimestampNegRiskPairs(
  trades: { id: string; outcome_index: number; side: 'buy' | 'sell'; qty: number; trade_time: string }[],
  windowSec: number = 5
): CrossTimestampPairingResult {
  // Parse timestamps and sort
  const parsed = trades.map((t) => ({
    ...t,
    timestamp: new Date(t.trade_time).getTime(),
    remainingQty: t.qty,
  }));

  // Separate by type
  const idx1Buys = parsed
    .filter((t) => t.outcome_index === 1 && t.side === 'buy')
    .sort((a, b) => a.timestamp - b.timestamp);

  const idx0Sells = parsed
    .filter((t) => t.outcome_index === 0 && t.side === 'sell')
    .sort((a, b) => a.timestamp - b.timestamp);

  // Calculate totals for stats
  const totalIdx0Sell = idx0Sells.reduce((s, t) => s + t.qty, 0);
  const totalIdx1Buy = idx1Buys.reduce((s, t) => s + t.qty, 0);

  const pairedIds = new Set<string>();
  let pairedQty = 0;
  let pairsFound = 0;

  // Use a sliding window approach
  // For each idx=0 sell, find idx=1 buys within window W
  const windowMs = windowSec * 1000;
  let buyPtr = 0; // Pointer into idx1Buys

  // Track remaining qty for each buy (mutable)
  const buyRemaining = new Map<string, number>();
  for (const b of idx1Buys) {
    buyRemaining.set(b.id, b.qty);
  }

  for (const sell of idx0Sells) {
    let sellRemaining = sell.qty;

    // Advance buyPtr to first buy within window
    while (buyPtr < idx1Buys.length && idx1Buys[buyPtr].timestamp < sell.timestamp - windowMs) {
      buyPtr++;
    }

    // Match sells with buys within the window
    for (let i = buyPtr; i < idx1Buys.length && sellRemaining > 0; i++) {
      const buy = idx1Buys[i];

      // Check if buy is within window (either before or after the sell)
      if (buy.timestamp > sell.timestamp + windowMs) {
        break; // Past the window
      }

      const buyRem = buyRemaining.get(buy.id) ?? 0;
      if (buyRem <= 0) continue;

      // Pair as much as possible
      const pairQty = Math.min(sellRemaining, buyRem);
      if (pairQty > 0) {
        pairedQty += pairQty;
        sellRemaining -= pairQty;
        buyRemaining.set(buy.id, buyRem - pairQty);

        // Mark both as paired
        pairedIds.add(sell.id);
        pairedIds.add(buy.id);
        pairsFound++;
      }
    }
  }

  // Also check the reverse pattern: idx=0 buy + idx=1 sell
  const idx0Buys = parsed
    .filter((t) => t.outcome_index === 0 && t.side === 'buy')
    .sort((a, b) => a.timestamp - b.timestamp);

  const idx1Sells = parsed
    .filter((t) => t.outcome_index === 1 && t.side === 'sell')
    .sort((a, b) => a.timestamp - b.timestamp);

  // Track remaining qty for idx0 buys
  const buy0Remaining = new Map<string, number>();
  for (const b of idx0Buys) {
    buy0Remaining.set(b.id, b.qty);
  }

  let buy0Ptr = 0;
  let reversePatternPaired = 0;

  for (const sell of idx1Sells) {
    let sellRemaining = sell.qty;

    while (buy0Ptr < idx0Buys.length && idx0Buys[buy0Ptr].timestamp < sell.timestamp - windowMs) {
      buy0Ptr++;
    }

    for (let i = buy0Ptr; i < idx0Buys.length && sellRemaining > 0; i++) {
      const buy = idx0Buys[i];

      if (buy.timestamp > sell.timestamp + windowMs) {
        break;
      }

      const buyRem = buy0Remaining.get(buy.id) ?? 0;
      if (buyRem <= 0) continue;

      const pairQty = Math.min(sellRemaining, buyRem);
      if (pairQty > 0) {
        reversePatternPaired += pairQty;
        sellRemaining -= pairQty;
        buy0Remaining.set(buy.id, buyRem - pairQty);

        pairedIds.add(sell.id);
        pairedIds.add(buy.id);
        pairsFound++;
      }
    }
  }

  // Add reverse pattern to paired qty
  pairedQty += reversePatternPaired;

  return {
    pairedIds,
    debugStats: {
      totalIdx0Sell,
      totalIdx1Buy,
      pairedQty,
      unpairedIdx0: totalIdx0Sell - pairedQty + reversePatternPaired, // Rough estimate
      unpairedIdx1: totalIdx1Buy - pairedQty + reversePatternPaired,
      pairsFound,
    },
  };
}

/**
 * Load raw trades for a specific condition for cross-timestamp analysis
 */
export async function loadRawTradesForCondition(
  wallet: string,
  conditionId: string
): Promise<{ id: string; outcome_index: number; side: 'buy' | 'sell'; qty: number; trade_time: string }[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    )
    SELECT
      d.event_id as id,
      m.outcome_index,
      d.side,
      d.qty_tokens as qty,
      d.trade_time
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    WHERE lower(m.condition_id) = lower('${conditionId}')
    ORDER BY d.trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    id: r.id,
    outcome_index: Number(r.outcome_index),
    side: r.side as 'buy' | 'sell',
    qty: Math.abs(Number(r.qty)),
    trade_time: r.trade_time,
  }));
}
