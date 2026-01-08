/**
 * UI Activity PnL Engine V13 - CLOB-Only
 *
 * ============================================================================
 * V13 FROZEN: CLOB-ONLY PNL ENGINE
 * Session: 2025-12-02 | Frozen: 2025-12-03
 * ============================================================================
 *
 * V13 DATA SOURCES:
 * -----------------
 * 1. CLOB trades (pm_trader_events_v3) for acquisitions and disposals
 *    - Buys: Actual market price paid
 *    - Sells: Actual market price received
 *    - Properly deduped by event_id (table has 3x duplicates from backfills)
 *
 * 2. CTF events (pm_ctf_events) for splits/merges/redemptions
 *    - PositionSplit: User deposits USDC, receives YES+NO at $0.50 each
 *    - PositionsMerge: User returns YES+NO, receives USDC at $0.50 each
 *
 * 3. Resolutions (pm_condition_resolutions) for payouts
 *    - payout_numerators array: [YES_payout, NO_payout]
 *    - Resolved positions pay out remaining qty * payout
 *
 * 4. NegRisk data (vw_negrisk_conversions) - STATS/DEBUG ONLY
 *    - Used for counting NegRisk acquisitions in metrics
 *    - NOT used in the PnL ledger (98% overlap with CLOB trades)
 *    - NegRisk's $0.50 cost basis is conceptual, not actual price paid
 *
 * WHY CLOB-ONLY:
 * --------------
 * Investigation found 98% of NegRisk entries overlap with CLOB buys at the
 * same timestamp. Using both sources causes double-counting. CLOB records
 * the actual market price the user paid, which is the correct cost basis.
 *
 * ACCURACY (8-wallet validation):
 * -------------------------------
 * - 7/8 wallets pass (error < 25%)
 * - 1 outlier (Smart Money 1) has sign mismatch, documented as special case
 *
 * CATEGORY SUPPORT:
 * -----------------
 * All trades enriched with category from pm_token_to_condition_map_v3
 * enabling per-category metrics: Omega, Sharpe, Sortino, Win Rate, ROI.
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV13 {
  wallet: string;

  // Core PnL
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_gain: number;
  total_loss: number;

  // Volume
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;

  // Counts
  total_trades: number;
  positions_count: number;
  markets_traded: number;

  // Source breakdown
  clob_trades: number;
  negrisk_acquisitions: number;
  ctf_splits: number;
  ctf_merges: number;
  resolutions: number;

  // Position detail
  positions: PositionSummaryV13[];

  // Trade returns for derived metrics
  trade_returns: TradeReturnV13[];

  // By-category breakdown
  by_category: CategoryMetrics[];
}

export interface PositionSummaryV13 {
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

export interface TradeReturnV13 {
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
  win_rate: number;
  omega_ratio: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  profit_factor: number;
  roi: number;
  avg_return: number;
  total_cost_basis: number;
}

type TradeSource = 'clob' | 'negrisk' | 'ctf_split' | 'ctf_merge' | 'resolution';

interface LedgerEntry {
  condition_id: string;
  outcome_index: number;
  category: string;
  trade_time: string;
  source: TradeSource;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
}

interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
  resolved_at: string;
}

// -----------------------------------------------------------------------------
// Position State (Weighted Average)
// -----------------------------------------------------------------------------

interface PositionState {
  amount: number;
  totalCost: number; // Sum of (qty * price) for all buys
  realized_pnl: number;
  trade_count: number;
  category: string;
}

function getAvgCost(state: PositionState): number {
  if (state.amount <= 0) return 0;
  return state.totalCost / state.amount;
}

// -----------------------------------------------------------------------------
// Data Loading - CLOB Trades
// -----------------------------------------------------------------------------

async function getClobTrades(wallet: string, negriskTokenDates?: Set<string>): Promise<LedgerEntry[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      m.category,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.token_id
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows
    .filter((r) => {
      // If this is a buy and we have NegRisk data for this token/date, skip it
      // (we'll use the NegRisk entry with correct $0.50 cost basis instead)
      if (r.side === 'buy' && negriskTokenDates) {
        const tradeDate = r.trade_time.substring(0, 10); // YYYY-MM-DD
        const key = `${r.token_id}_${tradeDate}`;
        if (negriskTokenDates.has(key)) {
          return false; // Skip this CLOB buy, use NegRisk instead
        }
      }
      return true;
    })
    .map((r) => ({
      condition_id: r.condition_id.toLowerCase(),
      outcome_index: Number(r.outcome_index),
      category: r.category || 'Other',
      trade_time: r.trade_time,
      source: 'clob' as const,
      side: r.side === 'buy' ? 'buy' : 'sell',
      qty: Math.abs(Number(r.qty_tokens)),
      price: Number(r.price),
    }));
}

// -----------------------------------------------------------------------------
// Data Loading - NegRisk Conversions (THE KEY FIX)
// -----------------------------------------------------------------------------

interface NegRiskResult {
  entries: LedgerEntry[];
  tokenDateKeys: Set<string>; // For deduplication: "tokenId_YYYY-MM-DD"
}

async function getNegRiskAcquisitions(wallet: string): Promise<NegRiskResult> {
  // NegRisk conversions: user acquires tokens at $0.50 cost basis
  // Join to token map to get condition_id and outcome_index
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      m.category,
      m.token_id_dec,
      n.block_timestamp as trade_time,
      n.shares as qty,
      n.cost_basis_per_share as price
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    WHERE lower(n.wallet) = lower('${wallet}')
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    const tokenDateKeys = new Set<string>();
    const entries: LedgerEntry[] = [];

    for (const r of rows) {
      // Build key for deduplication: token_id + date
      const tradeDate = String(r.trade_time).substring(0, 10);
      const key = `${r.token_id_dec}_${tradeDate}`;
      tokenDateKeys.add(key);

      entries.push({
        condition_id: r.condition_id.toLowerCase(),
        outcome_index: Number(r.outcome_index),
        category: r.category || 'Other',
        trade_time: r.trade_time,
        source: 'negrisk' as const,
        side: 'buy' as const,
        qty: Number(r.qty),
        price: Number(r.price), // $0.50
      });
    }

    return { entries, tokenDateKeys };
  } catch (err) {
    console.error('[V13] NegRisk query error:', err);
    return { entries: [], tokenDateKeys: new Set() };
  }
}

// -----------------------------------------------------------------------------
// Data Loading - CTF Events (Splits, Merges)
// -----------------------------------------------------------------------------

async function getCtfEvents(wallet: string): Promise<LedgerEntry[]> {
  const query = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge')
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    const entries: LedgerEntry[] = [];

    for (const r of rows) {
      const amount = Number(r.amount_or_payout) / 1e6;

      if (r.event_type === 'PositionSplit') {
        // Split: User deposits USDC, receives YES + NO tokens at $0.50 each
        for (const outcomeIndex of [0, 1]) {
          entries.push({
            condition_id: r.condition_id.toLowerCase(),
            outcome_index: outcomeIndex,
            category: 'Unknown', // Will enrich later
            trade_time: r.event_timestamp,
            source: 'ctf_split',
            side: 'buy',
            qty: amount,
            price: 0.5,
          });
        }
      } else if (r.event_type === 'PositionsMerge') {
        // Merge: User returns YES + NO, receives USDC at $0.50 each
        for (const outcomeIndex of [0, 1]) {
          entries.push({
            condition_id: r.condition_id.toLowerCase(),
            outcome_index: outcomeIndex,
            category: 'Unknown',
            trade_time: r.event_timestamp,
            source: 'ctf_merge',
            side: 'sell',
            qty: amount,
            price: 0.5,
          });
        }
      }
    }

    return entries;
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

let globalResolutionCache: Map<string, ResolutionInfo> | null = null;

async function loadAllResolutions(): Promise<Map<string, ResolutionInfo>> {
  if (globalResolutionCache) return globalResolutionCache;

  const result = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators, resolved_at FROM pm_condition_resolutions`,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const cache = new Map<string, ResolutionInfo>();

  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    cache.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: payouts,
      resolved_at: r.resolved_at,
    });
  }

  globalResolutionCache = cache;
  return cache;
}

// -----------------------------------------------------------------------------
// Category Enrichment
// -----------------------------------------------------------------------------

async function enrichCategories(
  entries: LedgerEntry[],
  conditionIds: string[]
): Promise<Map<string, string>> {
  if (conditionIds.length === 0) return new Map();

  const inClause = conditionIds.map((c) => `'${c}'`).join(',');
  const query = `
    SELECT DISTINCT condition_id, category
    FROM pm_token_to_condition_map_v3
    WHERE lower(condition_id) IN (${inClause})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const mapping = new Map<string, string>();
  for (const r of rows) {
    mapping.set(r.condition_id.toLowerCase(), r.category || 'Other');
  }
  return mapping;
}

// -----------------------------------------------------------------------------
// Core V13 Engine
// -----------------------------------------------------------------------------

export class V13Engine {
  private resolutionCache: Map<string, ResolutionInfo> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV13> {
    // Load resolution cache
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    // V13 APPROACH: Use CLOB trades only with actual market prices
    // NegRisk's $0.50 cost basis is conceptual, not what user actually paid
    // CLOB records the actual prices users paid/received
    const [clobTrades, ctfTrades] = await Promise.all([
      getClobTrades(wallet), // No NegRisk filtering - use all CLOB trades
      getCtfEvents(wallet),
    ]);

    // NegRisk stats for reporting only (not used in PnL calculation)
    const negRiskResult = await getNegRiskAcquisitions(wallet);
    const negriskCount = negRiskResult.entries.length;

    // Combine CLOB and CTF entries only (no NegRisk - it overlaps with CLOB)
    let allEntries: LedgerEntry[] = [...clobTrades, ...ctfTrades];

    // Enrich categories for CTF entries
    const unknownCategoryConditions = [
      ...new Set(
        allEntries.filter((e) => e.category === 'Unknown').map((e) => e.condition_id)
      ),
    ];

    if (unknownCategoryConditions.length > 0) {
      const categoryMap = await enrichCategories(allEntries, unknownCategoryConditions);
      allEntries = allEntries.map((e) => ({
        ...e,
        category: e.category === 'Unknown' ? categoryMap.get(e.condition_id) || 'Other' : e.category,
      }));
    }

    // Sort by time
    allEntries.sort((a, b) => a.trade_time.localeCompare(b.trade_time));

    // Process through position state machine
    const states = new Map<string, PositionState>();
    const getKey = (cid: string, idx: number) => `${cid}_${idx}`;

    const trade_returns: TradeReturnV13[] = [];

    let volume_buys = 0;
    let volume_sells = 0;
    let clob_trades = 0;
    let negrisk_acquisitions = 0;
    let ctf_splits = 0;
    let ctf_merges = 0;

    for (const entry of allEntries) {
      const key = getKey(entry.condition_id, entry.outcome_index);

      if (!states.has(key)) {
        states.set(key, {
          amount: 0,
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
        case 'negrisk':
          negrisk_acquisitions++;
          break;
        case 'ctf_split':
          ctf_splits++;
          break;
        case 'ctf_merge':
          ctf_merges++;
          break;
      }

      if (entry.side === 'buy') {
        // Add to position with weighted average
        const costOfThisBuy = entry.qty * entry.price;
        state.totalCost += costOfThisBuy;
        state.amount += entry.qty;
        volume_buys += costOfThisBuy;

        // Record acquisition (no PnL on buy)
        trade_returns.push({
          condition_id: entry.condition_id,
          outcome_index: entry.outcome_index,
          category: entry.category,
          trade_time: entry.trade_time,
          source: entry.source,
          side: 'buy',
          qty: entry.qty,
          price: entry.price,
          pnl: 0,
          return_pct: 0,
          cost_basis: costOfThisBuy,
        });
      } else {
        // SELL: realize PnL based on weighted average cost
        const avgCost = getAvgCost(state);
        const sellAmount = Math.min(entry.qty, state.amount);

        if (sellAmount > 0 && avgCost > 0) {
          const proceeds = sellAmount * entry.price;
          const costBasis = sellAmount * avgCost;
          const pnl = proceeds - costBasis;
          const return_pct = (entry.price - avgCost) / avgCost;

          state.realized_pnl += pnl;
          state.amount -= sellAmount;
          state.totalCost -= costBasis;

          volume_sells += proceeds;

          trade_returns.push({
            condition_id: entry.condition_id,
            outcome_index: entry.outcome_index,
            category: entry.category,
            trade_time: entry.trade_time,
            source: entry.source,
            side: 'sell',
            qty: sellAmount,
            price: entry.price,
            pnl,
            return_pct,
            cost_basis: costBasis,
          });
        }
      }
    }

    // Apply resolutions for remaining positions
    let resolutions = 0;
    for (const [key, state] of states.entries()) {
      if (state.amount > 0.001) {
        const [conditionId, outcomeStr] = key.split('_');
        const outcomeIndex = parseInt(outcomeStr, 10);
        const resolution = this.resolutionCache?.get(conditionId);

        if (resolution && resolution.payout_numerators.length > outcomeIndex) {
          const payout = resolution.payout_numerators[outcomeIndex];
          const avgCost = getAvgCost(state);
          const proceeds = state.amount * payout;
          const costBasis = state.amount * avgCost;
          const pnl = proceeds - costBasis;

          state.realized_pnl += pnl;
          resolutions++;

          if (avgCost > 0) {
            trade_returns.push({
              condition_id: conditionId,
              outcome_index: outcomeIndex,
              category: state.category,
              trade_time: resolution.resolved_at || 'resolved',
              source: 'resolution',
              side: 'resolution',
              qty: state.amount,
              price: payout,
              pnl,
              return_pct: (payout - avgCost) / avgCost,
              cost_basis: costBasis,
            });
          }

          state.amount = 0;
          state.totalCost = 0;
        }
      }
    }

    // Aggregate results
    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    const positions: PositionSummaryV13[] = [];
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

      if (state.amount > 0.001 && !isResolved) {
        // Use current market price (would need live price feed - for now use 0.5)
        const currentPrice = 0.5;
        const avgCost = getAvgCost(state);
        posUnrealized = state.amount * (currentPrice - avgCost);
        unrealized_pnl += posUnrealized;
      }

      positions.push({
        condition_id: conditionId,
        outcome_index: outcomeIndex,
        category: state.category,
        current_amount: state.amount,
        avg_cost_basis: getAvgCost(state),
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
      negrisk_acquisitions: negriskCount, // Use count from separate query (for stats only)
      ctf_splits,
      ctf_merges,
      resolutions,
      positions,
      trade_returns,
      by_category,
    };
  }

  private calculateCategoryMetrics(trade_returns: TradeReturnV13[]): CategoryMetrics[] {
    // Group by category
    const categoryMap = new Map<string, TradeReturnV13[]>();
    for (const tr of trade_returns) {
      if (!categoryMap.has(tr.category)) {
        categoryMap.set(tr.category, []);
      }
      categoryMap.get(tr.category)!.push(tr);
    }

    const result: CategoryMetrics[] = [];

    for (const [category, trades] of categoryMap.entries()) {
      // Only count sells/resolutions for PnL (buys have pnl=0)
      const pnlTrades = trades.filter((t) => t.side !== 'buy');

      const realized = pnlTrades.reduce((sum, t) => sum + t.pnl, 0);
      const totalCostBasis = pnlTrades.reduce((sum, t) => sum + t.cost_basis, 0);

      result.push({
        category,
        realized_pnl: realized,
        unrealized_pnl: 0, // Would need live prices
        total_pnl: realized,
        trades_count: trades.length,
        win_rate: calculateWinRate(pnlTrades),
        omega_ratio: calculateOmegaRatio(pnlTrades),
        sharpe_ratio: calculateSharpeRatio(pnlTrades),
        sortino_ratio: calculateSortinoRatio(pnlTrades),
        profit_factor: calculateProfitFactor(pnlTrades),
        roi: totalCostBasis > 0 ? realized / totalCostBasis : 0,
        avg_return:
          pnlTrades.length > 0
            ? pnlTrades.reduce((sum, t) => sum + t.return_pct, 0) / pnlTrades.length
            : 0,
        total_cost_basis: totalCostBasis,
      });
    }

    return result.sort((a, b) => b.total_pnl - a.total_pnl);
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

export function createV13Engine(): V13Engine {
  return new V13Engine();
}

// -----------------------------------------------------------------------------
// Metric Calculations
// -----------------------------------------------------------------------------

export function calculateOmegaRatio(trades: TradeReturnV13[], threshold: number = 0): number {
  const pnlTrades = trades.filter((t) => t.side !== 'buy');
  if (pnlTrades.length === 0) return 0;

  let gains = 0;
  let losses = 0;

  for (const tr of pnlTrades) {
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

export function calculateSharpeRatio(trades: TradeReturnV13[]): number {
  const pnlTrades = trades.filter((t) => t.side !== 'buy');
  if (pnlTrades.length < 2) return 0;

  const returns = pnlTrades.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;
  return mean / std;
}

export function calculateSortinoRatio(trades: TradeReturnV13[]): number {
  const pnlTrades = trades.filter((t) => t.side !== 'buy');
  if (pnlTrades.length < 2) return 0;

  const returns = pnlTrades.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return mean > 0 ? Infinity : 0;

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return mean > 0 ? Infinity : 0;
  return mean / downsideStd;
}

export function calculateWinRate(trades: TradeReturnV13[]): number {
  const pnlTrades = trades.filter((t) => t.side !== 'buy');
  if (pnlTrades.length === 0) return 0;
  const wins = pnlTrades.filter((tr) => tr.pnl > 0).length;
  return wins / pnlTrades.length;
}

export function calculateROI(trades: TradeReturnV13[]): number {
  const pnlTrades = trades.filter((t) => t.side !== 'buy');
  if (pnlTrades.length === 0) return 0;

  const totalPnL = pnlTrades.reduce((sum, tr) => sum + tr.pnl, 0);
  const totalCostBasis = pnlTrades.reduce((sum, tr) => sum + tr.cost_basis, 0);

  if (totalCostBasis === 0) return 0;
  return totalPnL / totalCostBasis;
}

export function calculateProfitFactor(trades: TradeReturnV13[]): number {
  const pnlTrades = trades.filter((t) => t.side !== 'buy');
  const grossProfit = pnlTrades.filter((tr) => tr.pnl > 0).reduce((sum, tr) => sum + tr.pnl, 0);
  const grossLoss = Math.abs(
    pnlTrades.filter((tr) => tr.pnl < 0).reduce((sum, tr) => sum + tr.pnl, 0)
  );

  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

// -----------------------------------------------------------------------------
// Debug Types & Functions
// -----------------------------------------------------------------------------

export interface LedgerEventSnapshot {
  time: string;
  source: TradeSource;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  cost_basis_running: number;
  avg_cost_running: number;
  position_qty_after: number;
  realized_pnl_after: number;
}

export interface ConditionLedgerDebug {
  condition_id: string;
  outcome_index: number;
  events: LedgerEventSnapshot[];
  final_position: number;
  final_realized_pnl: number;
  resolution_payout: number | null;
}

/**
 * Debug V13 ledger for a specific condition/outcome.
 * Returns every event with running totals for comparison against static ground truth.
 *
 * IMPORTANT: Uses the same CLOB-only logic as the main engine for consistency.
 * NegRisk entries are NOT included (they overlap with CLOB trades).
 */
export async function debugV13ConditionLedger(
  wallet: string,
  conditionId: string,
  outcomeIndex: number
): Promise<ConditionLedgerDebug> {
  // Load CLOB and CTF trades only (same as main engine - CLOB-only)
  const [clobTrades, ctfTrades] = await Promise.all([
    getClobTrades(wallet),
    getCtfEvents(wallet),
  ]);

  // Filter to just this condition/outcome
  const targetCid = conditionId.toLowerCase();
  const allEntries = [...clobTrades, ...ctfTrades]
    .filter((e) => e.condition_id === targetCid && e.outcome_index === outcomeIndex)
    .sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  // Process through state machine, recording snapshots
  let amount = 0;
  let totalCost = 0;
  let realizedPnl = 0;

  const events: LedgerEventSnapshot[] = [];

  for (const entry of allEntries) {
    if (entry.side === 'buy') {
      const costOfThisBuy = entry.qty * entry.price;
      totalCost += costOfThisBuy;
      amount += entry.qty;

      events.push({
        time: entry.trade_time,
        source: entry.source,
        side: 'buy',
        qty: entry.qty,
        price: entry.price,
        cost_basis_running: totalCost,
        avg_cost_running: amount > 0 ? totalCost / amount : 0,
        position_qty_after: amount,
        realized_pnl_after: realizedPnl,
      });
    } else {
      // SELL
      const avgCost = amount > 0 ? totalCost / amount : 0;
      const sellAmount = Math.min(entry.qty, amount);

      if (sellAmount > 0 && avgCost > 0) {
        const proceeds = sellAmount * entry.price;
        const costBasis = sellAmount * avgCost;
        const pnl = proceeds - costBasis;

        realizedPnl += pnl;
        amount -= sellAmount;
        totalCost -= costBasis;
      }

      events.push({
        time: entry.trade_time,
        source: entry.source,
        side: 'sell',
        qty: entry.qty,
        price: entry.price,
        cost_basis_running: totalCost,
        avg_cost_running: amount > 0 ? totalCost / amount : 0,
        position_qty_after: amount,
        realized_pnl_after: realizedPnl,
      });
    }
  }

  // Get resolution info
  const resolutionCache = await loadAllResolutions();
  const resolution = resolutionCache.get(targetCid);
  let resolutionPayout: number | null = null;

  if (resolution && resolution.payout_numerators.length > outcomeIndex) {
    resolutionPayout = resolution.payout_numerators[outcomeIndex];

    // Apply resolution if there's remaining position
    if (amount > 0.001) {
      const avgCost = amount > 0 ? totalCost / amount : 0;
      const proceeds = amount * resolutionPayout;
      const costBasis = amount * avgCost;
      const pnl = proceeds - costBasis;

      realizedPnl += pnl;

      events.push({
        time: resolution.resolved_at || 'resolved',
        source: 'resolution',
        side: 'sell',
        qty: amount,
        price: resolutionPayout,
        cost_basis_running: 0,
        avg_cost_running: avgCost,
        position_qty_after: 0,
        realized_pnl_after: realizedPnl,
      });

      amount = 0;
      totalCost = 0;
    }
  }

  return {
    condition_id: conditionId,
    outcome_index: outcomeIndex,
    events,
    final_position: amount,
    final_realized_pnl: realizedPnl,
    resolution_payout: resolutionPayout,
  };
}
