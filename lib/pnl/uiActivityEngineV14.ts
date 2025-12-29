/**
 * UI Activity PnL Engine V14 - CLOB-Only with Short Position Support
 *
 * ============================================================================
 * V14: FIXES V13's CRITICAL BUG - NOW HANDLES SHORT POSITIONS
 * Session: 2025-12-03
 * ============================================================================
 *
 * V13 BUG: Treated position as always >= 0, ignoring sells-before-buys.
 * This caused massive errors for market makers / LPs who go short.
 *
 * V14 FIX: Position can now be negative (short).
 * - Sells that exceed buys create SHORT positions
 * - Shorts accumulate proceeds as negative cost basis
 * - Resolution settles both longs and shorts correctly:
 *   - Long resolved to $1 = profit
 *   - Long resolved to $0 = loss
 *   - Short resolved to $1 = LOSS (you owe the settlement)
 *   - Short resolved to $0 = profit (your liability goes to zero)
 *
 * Example: Smart Money 1 on Trump election market
 * - Sold 45.8M YES shares at $0.60 (short position)
 * - Market resolved YES ($1 payout)
 * - V13 ignored this → $275 PnL (wrong)
 * - V14 correctly calculates → massive loss (short owes $1/share)
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types (same as V13)
// -----------------------------------------------------------------------------

export interface WalletMetricsV14 {
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
  ctf_splits: number;
  ctf_merges: number;
  resolutions: number;
  positions: PositionSummaryV14[];
  trade_returns: TradeReturnV14[];
  by_category: CategoryMetrics[];
}

export interface PositionSummaryV14 {
  condition_id: string;
  outcome_index: number;
  category: string;
  current_amount: number; // Can be negative for shorts
  avg_cost_basis: number;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: boolean;
  resolution_payout: number | null;
}

export interface TradeReturnV14 {
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

type TradeSource = 'clob' | 'negrisk' | 'ctf_split' | 'ctf_merge' | 'resolution';

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
// CORE LEDGER STATE MACHINE - Now supports signed positions (shorts)
// -----------------------------------------------------------------------------

interface LedgerState {
  position: number;      // Signed: positive = long, negative = short
  totalCost: number;     // Signed: positive for long cost, negative for short proceeds
  realized_pnl: number;
  trade_count: number;
  category: string;
}

/**
 * Apply a trade to the ledger state.
 * Handles:
 * - Buys that close shorts, then open longs
 * - Sells that close longs, then open shorts
 */
function applyTrade(
  state: LedgerState,
  side: 'buy' | 'sell',
  qty: number,
  price: number
): { pnl: number; closedQty: number; openedQty: number } {
  let pnl = 0;
  let closedQty = 0;
  let openedQty = 0;
  let remainingQty = qty;

  if (side === 'buy') {
    // First, close any existing short position
    if (state.position < 0 && remainingQty > 0) {
      const shortQty = -state.position;
      const closeQty = Math.min(remainingQty, shortQty);

      // When short, totalCost is negative (proceeds from shorting)
      // avgShortPrice = |totalCost| / |position| = -totalCost / -position
      const avgShortPrice = state.totalCost / state.position; // This is negative/negative = positive

      // Closing a short: we sold at avgShortPrice, now buy back at price
      // PnL = (avgShortPrice - price) * closeQty
      const closePnl = (avgShortPrice - price) * closeQty;
      pnl += closePnl;
      state.realized_pnl += closePnl;

      // Reduce the short position
      state.position += closeQty; // position moves toward 0
      state.totalCost += avgShortPrice * closeQty; // totalCost moves toward 0

      closedQty = closeQty;
      remainingQty -= closeQty;
    }

    // Then, any remaining buys open/add to a long position
    if (remainingQty > 0) {
      state.position += remainingQty;
      state.totalCost += remainingQty * price;
      openedQty = remainingQty;
    }
  } else {
    // side === 'sell'
    // First, close any existing long position
    if (state.position > 0 && remainingQty > 0) {
      const longQty = state.position;
      const closeQty = Math.min(remainingQty, longQty);

      const avgLongPrice = state.totalCost / state.position;

      // Closing a long: we bought at avgLongPrice, now sell at price
      // PnL = (price - avgLongPrice) * closeQty
      const closePnl = (price - avgLongPrice) * closeQty;
      pnl += closePnl;
      state.realized_pnl += closePnl;

      // Reduce the long position
      state.position -= closeQty;
      state.totalCost -= avgLongPrice * closeQty;

      closedQty = closeQty;
      remainingQty -= closeQty;
    }

    // Then, any remaining sells open/add to a short position
    if (remainingQty > 0) {
      state.position -= remainingQty; // position goes negative
      state.totalCost -= remainingQty * price; // totalCost goes negative (proceeds)
      openedQty = remainingQty;
    }
  }

  return { pnl, closedQty, openedQty };
}

/**
 * Settle a position at resolution.
 * Handles both long and short positions.
 */
function settleAtResolution(state: LedgerState, payout: number): number {
  if (Math.abs(state.position) < 0.001) return 0;

  let pnl = 0;

  if (state.position > 0) {
    // Long position: bought at avgPrice, token now worth payout
    const avgPrice = state.totalCost / state.position;
    pnl = (payout - avgPrice) * state.position;
  } else {
    // Short position: sold at avgPrice, now effectively buy back at payout
    const shortQty = -state.position;
    const avgPrice = -state.totalCost / shortQty; // totalCost is negative, so negate
    pnl = (avgPrice - payout) * shortQty;
  }

  state.realized_pnl += pnl;
  state.position = 0;
  state.totalCost = 0;

  return pnl;
}

// -----------------------------------------------------------------------------
// Data Loading (same as V13)
// -----------------------------------------------------------------------------

async function getClobTrades(wallet: string): Promise<TradeEntry[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_amount,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      d.trade_time,
      d.side,
      d.qty_tokens as qty,
      CASE WHEN d.qty_tokens > 0 THEN d.usdc_amount / d.qty_tokens ELSE 0 END as price,
      COALESCE(m.category, 'Other') as category
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    trade_time: r.trade_time,
    source: 'clob' as TradeSource,
    side: r.side as 'buy' | 'sell',
    qty: Math.abs(Number(r.qty)),
    price: Number(r.price),
    category: r.category || 'Other',
  }));
}

async function getCtfEvents(wallet: string): Promise<TradeEntry[]> {
  const query = `
    SELECT
      condition_id,
      event_type,
      amount_or_payout,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge')
    ORDER BY event_timestamp
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    const entries: TradeEntry[] = [];
    for (const r of rows) {
      const qty = Math.abs(Number(r.amount_or_payout) / 1e18);
      const tradeTime = r.event_timestamp;
      const conditionId = r.condition_id.toLowerCase();

      if (r.event_type === 'PositionSplit') {
        // Split creates BOTH outcomes at $0.50 each
        entries.push({
          condition_id: conditionId,
          outcome_index: 0,
          trade_time: tradeTime,
          source: 'ctf_split',
          side: 'buy',
          qty,
          price: 0.5,
          category: 'Other',
        });
        entries.push({
          condition_id: conditionId,
          outcome_index: 1,
          trade_time: tradeTime,
          source: 'ctf_split',
          side: 'buy',
          qty,
          price: 0.5,
          category: 'Other',
        });
      } else if (r.event_type === 'PositionsMerge') {
        // Merge sells BOTH outcomes at $0.50 each
        entries.push({
          condition_id: conditionId,
          outcome_index: 0,
          trade_time: tradeTime,
          source: 'ctf_merge',
          side: 'sell',
          qty,
          price: 0.5,
          category: 'Other',
        });
        entries.push({
          condition_id: conditionId,
          outcome_index: 1,
          trade_time: tradeTime,
          source: 'ctf_merge',
          side: 'sell',
          qty,
          price: 0.5,
          category: 'Other',
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

async function getNegriskCount(wallet: string): Promise<number> {
  const query = `
    SELECT count() as cnt
    FROM vw_negrisk_conversions
    WHERE lower(wallet) = lower('${wallet}')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows[0]?.cnt ?? 0;
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

// -----------------------------------------------------------------------------
// V14 Engine
// -----------------------------------------------------------------------------

class V14Engine {
  private resolutionCache: Map<string, Resolution> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV14> {
    // Load all data sources
    const [clobTrades, ctfTrades, negriskCount] = await Promise.all([
      getClobTrades(wallet),
      getCtfEvents(wallet),
      getNegriskCount(wallet),
    ]);

    // Load resolutions once
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    // Combine and sort all entries by time
    const allEntries = [...clobTrades, ...ctfTrades].sort((a, b) =>
      a.trade_time.localeCompare(b.trade_time)
    );

    // Process through state machine
    const states = new Map<string, LedgerState>();
    const trade_returns: TradeReturnV14[] = [];

    let clob_trades = 0;
    let ctf_splits = 0;
    let ctf_merges = 0;
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

      // Track source counts
      switch (entry.source) {
        case 'clob':
          clob_trades++;
          break;
        case 'ctf_split':
          ctf_splits++;
          break;
        case 'ctf_merge':
          ctf_merges++;
          break;
      }

      // Apply trade using new signed-position logic
      const tradeResult = applyTrade(state, entry.side, entry.qty, entry.price);

      // Track volume
      const tradeValue = entry.qty * entry.price;
      if (entry.side === 'buy') {
        volume_buys += tradeValue;
      } else {
        volume_sells += tradeValue;
      }

      // Record trade return
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
        return_pct: tradeResult.closedQty > 0 && entry.price > 0
          ? tradeResult.pnl / (tradeResult.closedQty * entry.price)
          : 0,
        cost_basis: tradeValue,
      });
    }

    // Apply resolutions for remaining positions (both long AND short)
    let resolutions = 0;
    for (const [key, state] of states.entries()) {
      if (Math.abs(state.position) > 0.001) {
        const [conditionId, outcomeStr] = key.split('_');
        const outcomeIndex = parseInt(outcomeStr, 10);
        const resolution = this.resolutionCache?.get(conditionId);

        if (resolution && resolution.payout_numerators.length > outcomeIndex) {
          const payout = resolution.payout_numerators[outcomeIndex];
          const prePosition = state.position;
          const resPnl = settleAtResolution(state, payout);

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

    // Aggregate results
    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    const positions: PositionSummaryV14[] = [];
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

      // Calculate unrealized for open positions
      let posUnrealized = 0;
      const resolution = this.resolutionCache?.get(conditionId);
      const isResolved = !!resolution;

      if (Math.abs(state.position) > 0.001 && !isResolved) {
        const currentPrice = 0.5; // Default assumption
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
        avg_cost_basis: state.position !== 0 ? Math.abs(state.totalCost / state.position) : 0,
        realized_pnl: state.realized_pnl,
        unrealized_pnl: posUnrealized,
        is_resolved: isResolved,
        resolution_payout: resolution?.payout_numerators[outcomeIndex] ?? null,
      });
    }

    // Calculate by-category metrics
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
      ctf_splits,
      ctf_merges,
      resolutions,
      positions,
      trade_returns,
      by_category,
    };
  }

  private calculateCategoryMetrics(trade_returns: TradeReturnV14[]): CategoryMetrics[] {
    const categoryMap = new Map<string, TradeReturnV14[]>();
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
      const total_cost = trades.filter((t) => t.side === 'buy').reduce((s, t) => s + t.cost_basis, 0);

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

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export function createV14Engine(): V14Engine {
  return new V14Engine();
}

// -----------------------------------------------------------------------------
// Debug Ledger (updated for signed positions)
// -----------------------------------------------------------------------------

export interface LedgerEventSnapshot {
  time: string;
  source: TradeSource;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  position_after: number; // Can be negative
  total_cost_after: number; // Can be negative
  avg_price_after: number;
  realized_pnl_after: number;
}

export interface ConditionLedgerDebugV14 {
  condition_id: string;
  outcome_index: number;
  events: LedgerEventSnapshot[];
  final_position: number;
  final_realized_pnl: number;
  resolution_payout: number | null;
}

export async function debugV14ConditionLedger(
  wallet: string,
  conditionId: string,
  outcomeIndex: number
): Promise<ConditionLedgerDebugV14> {
  const [clobTrades, ctfTrades] = await Promise.all([
    getClobTrades(wallet),
    getCtfEvents(wallet),
  ]);

  const targetCid = conditionId.toLowerCase();
  const allEntries = [...clobTrades, ...ctfTrades]
    .filter((e) => e.condition_id === targetCid && e.outcome_index === outcomeIndex)
    .sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  const state: LedgerState = {
    position: 0,
    totalCost: 0,
    realized_pnl: 0,
    trade_count: 0,
    category: 'Other',
  };

  const events: LedgerEventSnapshot[] = [];

  for (const entry of allEntries) {
    applyTrade(state, entry.side, entry.qty, entry.price);

    events.push({
      time: entry.trade_time,
      source: entry.source,
      side: entry.side,
      qty: entry.qty,
      price: entry.price,
      position_after: state.position,
      total_cost_after: state.totalCost,
      avg_price_after: state.position !== 0 ? Math.abs(state.totalCost / state.position) : 0,
      realized_pnl_after: state.realized_pnl,
    });
  }

  // Apply resolution
  const resolutionCache = await loadAllResolutions();
  const resolution = resolutionCache.get(targetCid);
  let resolutionPayout: number | null = null;

  if (resolution && resolution.payout_numerators.length > outcomeIndex) {
    resolutionPayout = resolution.payout_numerators[outcomeIndex];

    if (Math.abs(state.position) > 0.001) {
      settleAtResolution(state, resolutionPayout);

      events.push({
        time: resolution.resolved_at || 'resolved',
        source: 'resolution',
        side: 'sell',
        qty: Math.abs(state.position),
        price: resolutionPayout,
        position_after: 0,
        total_cost_after: 0,
        avg_price_after: 0,
        realized_pnl_after: state.realized_pnl,
      });
    }
  }

  return {
    condition_id: conditionId,
    outcome_index: outcomeIndex,
    events,
    final_position: state.position,
    final_realized_pnl: state.realized_pnl,
    resolution_payout: resolutionPayout,
  };
}
