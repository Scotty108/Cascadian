/**
 * UI Activity PnL Engine V15 - CLOB-Only with Short Support + NegRisk Pair Consolidation
 *
 * ============================================================================
 * V15: HANDLES BOTH SHORTS AND NEGRISK PAIRED TRADES CORRECTLY
 * Session: 2025-12-03
 * ============================================================================
 *
 * V13 BUG: Ignored all sells-before-buys (wrong for real market makers)
 * V14 BUG: Treated NegRisk paired trades as independent shorts (2x PnL)
 *
 * V15 FIX: Detect and consolidate NegRisk paired trades
 * - Same timestamp + same condition + same qty + buy/sell on different outcomes
 *   → Consolidate to single "buy" on the outcome being bought
 * - Unpaired sells → Track as real short positions (for market makers)
 *
 * Example NegRisk paired trade:
 *   Buy 500 idx=1 @ $0.44 + Sell 500 idx=0 @ $0.56 at same timestamp
 *   → Consolidate to: Buy 500 idx=1 @ $0.44 (net cost $220-$280=-$60, user received $60)
 *   → The $0.56 "sell" was minting+selling, not a real short
 *
 * Example real short (market making):
 *   Sell 1000 idx=0 @ $0.60 with no matching buy at same timestamp
 *   → Track as short position, resolve correctly
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types (same as V14)
// -----------------------------------------------------------------------------

export interface WalletMetricsV15 {
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
  paired_trades_consolidated: number; // NEW: count of paired trades found
  positions: PositionSummaryV15[];
  trade_returns: TradeReturnV15[];
  by_category: CategoryMetrics[];
}

export interface PositionSummaryV15 {
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

export interface TradeReturnV15 {
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
  is_paired: boolean; // NEW: flag to skip paired sell legs
}

interface Resolution {
  condition_id: string;
  payout_numerators: number[];
  resolved_at: string | null;
}

// -----------------------------------------------------------------------------
// CORE LEDGER STATE MACHINE - Same as V14
// -----------------------------------------------------------------------------

interface LedgerState {
  position: number;
  totalCost: number;
  realized_pnl: number;
  trade_count: number;
  category: string;
}

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
    if (state.position < 0 && remainingQty > 0) {
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
    if (remainingQty > 0) {
      state.position -= remainingQty;
      state.totalCost -= remainingQty * price;
      openedQty = remainingQty;
    }
  }

  return { pnl, closedQty, openedQty };
}

function settleAtResolution(state: LedgerState, payout: number): number {
  if (Math.abs(state.position) < 0.001) return 0;

  let pnl = 0;

  if (state.position > 0) {
    const avgPrice = state.totalCost / state.position;
    pnl = (payout - avgPrice) * state.position;
  } else {
    const shortQty = -state.position;
    const avgPrice = -state.totalCost / shortQty;
    pnl = (avgPrice - payout) * shortQty;
  }

  state.realized_pnl += pnl;
  state.position = 0;
  state.totalCost = 0;

  return pnl;
}

// -----------------------------------------------------------------------------
// Data Loading with Paired Trade Detection
// -----------------------------------------------------------------------------

async function getClobTrades(wallet: string): Promise<{ entries: TradeEntry[]; pairedCount: number }> {
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
    ORDER BY d.trade_time, m.condition_id, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // First pass: collect all trades
  const rawEntries: TradeEntry[] = rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    trade_time: r.trade_time,
    source: 'clob' as TradeSource,
    side: r.side as 'buy' | 'sell',
    qty: Math.abs(Number(r.qty)),
    price: Number(r.price),
    category: r.category || 'Other',
    is_paired: false,
  }));

  // Second pass: detect and mark paired trades using O(N) hash map approach
  // A paired trade is: same timestamp + same condition + same qty + buy on one outcome + sell on other
  let pairedCount = 0;

  // Build a hash map: key = "conditionId_timestamp_qtyRounded" → array of indices
  const buyMap = new Map<string, number[]>();

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];
    if (entry.side !== 'buy') continue;

    // Round qty to 2 decimal places for matching
    const qtyKey = entry.qty.toFixed(2);
    const key = `${entry.condition_id}_${entry.trade_time}_${qtyKey}`;

    if (!buyMap.has(key)) {
      buyMap.set(key, []);
    }
    buyMap.get(key)!.push(i);
  }

  // Now scan sells and look up matching buys in O(1) per sell
  const usedBuys = new Set<number>();

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];
    if (entry.side !== 'sell') continue;

    const qtyKey = entry.qty.toFixed(2);
    const key = `${entry.condition_id}_${entry.trade_time}_${qtyKey}`;

    const candidates = buyMap.get(key);
    if (!candidates) continue;

    // Find a buy with different outcome_index that hasn't been used
    for (const buyIdx of candidates) {
      if (usedBuys.has(buyIdx)) continue;

      const buyEntry = rawEntries[buyIdx];
      if (buyEntry.outcome_index !== entry.outcome_index) {
        // This is a NegRisk paired trade!
        // Mark the sell as paired (skip it), keep the buy
        entry.is_paired = true;
        usedBuys.add(buyIdx);
        pairedCount++;
        break;
      }
    }
  }

  // Filter out paired sell legs
  const entries = rawEntries.filter((e) => !e.is_paired);

  return { entries, pairedCount };
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
        entries.push({
          condition_id: conditionId,
          outcome_index: 0,
          trade_time: tradeTime,
          source: 'ctf_split',
          side: 'buy',
          qty,
          price: 0.5,
          category: 'Other',
          is_paired: false,
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
          is_paired: false,
        });
      } else if (r.event_type === 'PositionsMerge') {
        entries.push({
          condition_id: conditionId,
          outcome_index: 0,
          trade_time: tradeTime,
          source: 'ctf_merge',
          side: 'sell',
          qty,
          price: 0.5,
          category: 'Other',
          is_paired: false,
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
          is_paired: false,
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

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    return rows[0]?.cnt ?? 0;
  } catch {
    return 0;
  }
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
// V15 Engine
// -----------------------------------------------------------------------------

class V15Engine {
  private resolutionCache: Map<string, Resolution> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV15> {
    const [clobResult, ctfTrades, negriskCount] = await Promise.all([
      getClobTrades(wallet),
      getCtfEvents(wallet),
      getNegriskCount(wallet),
    ]);

    const clobTrades = clobResult.entries;
    const pairedTradesConsolidated = clobResult.pairedCount;

    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const allEntries = [...clobTrades, ...ctfTrades].sort((a, b) =>
      a.trade_time.localeCompare(b.trade_time)
    );

    const states = new Map<string, LedgerState>();
    const trade_returns: TradeReturnV15[] = [];

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

      const tradeResult = applyTrade(state, entry.side, entry.qty, entry.price);

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
        return_pct: tradeResult.closedQty > 0 && entry.price > 0
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

    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    const positions: PositionSummaryV15[] = [];
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
        avg_cost_basis: state.position !== 0 ? Math.abs(state.totalCost / state.position) : 0,
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
      ctf_splits,
      ctf_merges,
      resolutions,
      paired_trades_consolidated: pairedTradesConsolidated,
      positions,
      trade_returns,
      by_category,
    };
  }

  private calculateCategoryMetrics(trade_returns: TradeReturnV15[]): CategoryMetrics[] {
    const categoryMap = new Map<string, TradeReturnV15[]>();
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

export function createV15Engine(): V15Engine {
  return new V15Engine();
}
