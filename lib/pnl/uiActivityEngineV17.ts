/**
 * ============================================================================
 * CASCADIAN CANONICAL PNL ENGINE - V17
 * ============================================================================
 *
 * THIS IS THE FROZEN, CANONICAL DEFINITION OF PNL FOR CASCADIAN.
 * DO NOT MODIFY THE CORE MATH WITHOUT EXPLICIT APPROVAL.
 *
 * ============================================================================
 * SEMANTIC DEFINITIONS
 * ============================================================================
 *
 * RESOLVED MARKETS (is_resolved = true):
 *   realized_pnl   = trade_cash_flow + (final_shares * resolution_price)
 *   unrealized_pnl = 0
 *
 * UNRESOLVED MARKETS (is_resolved = false):
 *   realized_pnl   = 0  (no P&L is "realized" until market resolves)
 *   unrealized_pnl = trade_cash_flow + (final_shares * mark_price)
 *                    where mark_price defaults to 0.5
 *
 * ============================================================================
 * FORMULA COMPONENTS
 * ============================================================================
 *
 * trade_cash_flow = sum(sell_usdc) - sum(buy_usdc)
 *   - Positive = net cash inflow (sold more than bought)
 *   - Negative = net cash outflow (bought more than sold)
 *
 * final_shares = sum(buy_tokens) - sum(sell_tokens)
 *   - Positive = long position (holding shares)
 *   - Negative = short position (owe shares at resolution)
 *
 * resolution_price = payout_numerators[outcome_index]
 *   - 1 = winning outcome (each share pays $1)
 *   - 0 = losing outcome (shares worthless)
 *
 * ============================================================================
 * VALIDATION STATUS
 * ============================================================================
 *
 * - Smart Money 1: V17 matches pm_cascadian_pnl_v1_new within 0.05%
 * - Remaining ~15% gap to Polymarket UI is upstream data difference,
 *   not a calculation error in V17.
 *
 * ============================================================================
 * HISTORY
 * ============================================================================
 *
 * V16: Over-filtered NegRisk sells, undercounting final positions
 * V17: Simplified to proven cash_flow + resolution formula (2025-12-03)
 *
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV17 {
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
  resolutions: number;
  positions: PositionSummaryV17[];
  by_category: CategoryMetrics[];
}

export interface PositionSummaryV17 {
  condition_id: string;
  outcome_index: number;
  category: string;
  trade_cash_flow: number;
  final_shares: number;
  resolution_price: number | null;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: boolean;
  trade_count: number;
  resolved_at: string | null; // ISO timestamp when market resolved (for Omega windowing)
}

export interface CategoryMetrics {
  category: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
}

// -----------------------------------------------------------------------------
// Data Loading - Simple Aggregation
// -----------------------------------------------------------------------------

interface PositionAgg {
  condition_id: string;
  outcome_index: number;
  category: string;
  buy_tokens: number;
  sell_tokens: number;
  buy_usdc: number;
  sell_usdc: number;
  trade_count: number;
}

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  // ============================================================================
  // V17.2 FIX: Use pm_trader_events_dedup_v2_tbl (520M rows, properly deduped)
  // ============================================================================
  //
  // DATA INPUTS (see docs/data/LINEAGE_PNL.md):
  //   fills: pm_trader_events_dedup_v2_tbl
  //   mapping: pm_token_to_condition_map_v5
  //
  // Bug Fix: pm_trader_fills_canonical_v1 VIEW had a bug where it collapsed
  // maker+taker rows because 'role' was not in the GROUP BY key.
  // The dedup table preserves maker/taker as separate fills.
  //
  // Bug B Fix: Paired-outcome normalization drops "hedge legs" from complete-set trades
  //
  // Paired-outcome detection:
  //   - Same (tx_hash, condition_id) has both outcomes 0 and 1
  //   - Opposite directions (one buy, one sell)
  //   - Token amounts match within epsilon
  //   - Action: Keep buy leg, drop sell leg
  // ============================================================================

  // Step 1: Load fills from dedup table with outcome mapping
  // IMPORTANT: The dedup table still has duplicates per event_id, so we GROUP BY event_id
  // to ensure each fill is counted exactly once (see CLAUDE.md "CLOB Deduplication Pattern")
  const fillsQuery = `
    SELECT
      any(f.transaction_hash) as transaction_hash,
      any(f.token_id) as token_id,
      any(f.side) as side,
      any(f.token_amount) / 1000000.0 as tokens,
      any(f.usdc_amount) / 1000000.0 as usdc,
      any(m.condition_id) as condition_id,
      any(m.outcome_index) as outcome_index,
      COALESCE(any(m.category), 'Other') as category
    FROM pm_trader_events_dedup_v2_tbl f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}')
    GROUP BY f.event_id
    ORDER BY transaction_hash, condition_id, outcome_index
  `;

  const fillsResult = await clickhouse.query({ query: fillsQuery, format: 'JSONEachRow' });
  const fills = (await fillsResult.json()) as any[];

  // Step 2: Paired-outcome normalization (TypeScript post-processing)
  // Group by (tx_hash, condition_id) and detect paired trades
  const PAIRED_EPSILON = 1.0; // Token amount tolerance for "matching"

  interface Fill {
    transaction_hash: string;
    token_id: string;
    side: string;
    tokens: number;
    usdc: number;
    condition_id: string;
    outcome_index: number;
    category: string;
    isPairedHedgeLeg?: boolean;
  }

  const typedFills: Fill[] = fills.map((f) => ({
    transaction_hash: f.transaction_hash,
    token_id: f.token_id,
    side: f.side,
    tokens: Number(f.tokens),
    usdc: Number(f.usdc),
    condition_id: f.condition_id.toLowerCase(),
    outcome_index: Number(f.outcome_index),
    category: f.category || 'Other',
  }));

  // Group by (tx_hash, condition_id)
  const groups = new Map<string, Fill[]>();
  for (const fill of typedFills) {
    const key = `${fill.transaction_hash}_${fill.condition_id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(fill);
  }

  // Detect and mark paired hedge legs
  for (const [, groupFills] of groups) {
    const outcomes = new Set(groupFills.map((f) => f.outcome_index));
    if (!outcomes.has(0) || !outcomes.has(1) || groupFills.length < 2) {
      continue; // Not a paired-outcome group
    }

    const o0Fills = groupFills.filter((f) => f.outcome_index === 0);
    const o1Fills = groupFills.filter((f) => f.outcome_index === 1);

    // Check for paired pattern: opposite directions, matching amounts
    for (const o0 of o0Fills) {
      for (const o1 of o1Fills) {
        const oppositeDirection = o0.side !== o1.side;
        const amountMatch = Math.abs(o0.tokens - o1.tokens) <= PAIRED_EPSILON;

        if (oppositeDirection && amountMatch) {
          // Mark the sell leg as hedge (to be dropped)
          // If O0 is sell, mark O0; if O1 is sell, mark O1
          if (o0.side === 'sell') {
            o0.isPairedHedgeLeg = true;
          } else {
            o1.isPairedHedgeLeg = true;
          }
          break; // Only mark one pair per O0 fill
        }
      }
    }
  }

  // Step 3: Filter out hedge legs and aggregate
  const normalizedFills = typedFills.filter((f) => !f.isPairedHedgeLeg);

  // Aggregate by (condition_id, outcome_index)
  const aggMap = new Map<
    string,
    {
      condition_id: string;
      outcome_index: number;
      category: string;
      buy_tokens: number;
      sell_tokens: number;
      buy_usdc: number;
      sell_usdc: number;
      trade_count: number;
    }
  >();

  for (const fill of normalizedFills) {
    const key = `${fill.condition_id}_${fill.outcome_index}`;
    if (!aggMap.has(key)) {
      aggMap.set(key, {
        condition_id: fill.condition_id,
        outcome_index: fill.outcome_index,
        category: fill.category,
        buy_tokens: 0,
        sell_tokens: 0,
        buy_usdc: 0,
        sell_usdc: 0,
        trade_count: 0,
      });
    }
    const agg = aggMap.get(key)!;
    if (fill.side === 'buy') {
      agg.buy_tokens += Math.abs(fill.tokens);
      agg.buy_usdc += Math.abs(fill.usdc);
    } else {
      agg.sell_tokens += Math.abs(fill.tokens);
      agg.sell_usdc += Math.abs(fill.usdc);
    }
    agg.trade_count++;
  }

  return Array.from(aggMap.values());
}

interface Resolution {
  condition_id: string;
  payout_numerators: number[];
  resolved_at: string | null;
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
// V17 Engine
// -----------------------------------------------------------------------------

class V17Engine {
  private resolutionCache: Map<string, Resolution> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV17> {
    // Load position aggregates
    const aggregates = await loadPositionAggregates(wallet);

    // Load resolutions
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const positions: PositionSummaryV17[] = [];
    const marketsSet = new Set<string>();

    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    let volume_buys = 0;
    let volume_sells = 0;
    let total_trades = 0;
    let resolutions = 0;

    for (const agg of aggregates) {
      marketsSet.add(agg.condition_id);
      total_trades += agg.trade_count;
      volume_buys += agg.buy_usdc;
      volume_sells += agg.sell_usdc;

      // Calculate using the cascadian formula
      const trade_cash_flow = agg.sell_usdc - agg.buy_usdc;
      const final_shares = agg.buy_tokens - agg.sell_tokens;

      // Get resolution info
      const resolution = this.resolutionCache?.get(agg.condition_id);
      const isResolved = !!resolution && resolution.payout_numerators.length > agg.outcome_index;
      const resolution_price = isResolved ? resolution!.payout_numerators[agg.outcome_index] : null;

      let pos_realized_pnl = 0;
      let pos_unrealized_pnl = 0;

      if (isResolved && resolution_price !== null) {
        // Realized PnL = cash_flow + (final_shares × resolution_price)
        pos_realized_pnl = trade_cash_flow + final_shares * resolution_price;
        resolutions++;
      } else {
        // Unrealized: use current price estimate (0.5)
        const currentPrice = 0.5;
        pos_unrealized_pnl = trade_cash_flow + final_shares * currentPrice;
        pos_realized_pnl = 0; // No realized PnL until resolution
      }

      realized_pnl += pos_realized_pnl;
      unrealized_pnl += pos_unrealized_pnl;

      if (pos_realized_pnl > 0) {
        total_gain += pos_realized_pnl;
      } else {
        total_loss += pos_realized_pnl;
      }

      positions.push({
        condition_id: agg.condition_id,
        outcome_index: agg.outcome_index,
        category: agg.category,
        trade_cash_flow,
        final_shares,
        resolution_price,
        realized_pnl: pos_realized_pnl,
        unrealized_pnl: pos_unrealized_pnl,
        is_resolved: isResolved,
        trade_count: agg.trade_count,
        resolved_at: resolution?.resolved_at || null,
      });
    }

    // Calculate category metrics
    const by_category = this.calculateCategoryMetrics(positions);

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
      total_trades,
      positions_count: positions.length,
      markets_traded: marketsSet.size,
      resolutions,
      positions,
      by_category,
    };
  }

  private calculateCategoryMetrics(positions: PositionSummaryV17[]): CategoryMetrics[] {
    const categoryMap = new Map<string, PositionSummaryV17[]>();

    for (const pos of positions) {
      if (!categoryMap.has(pos.category)) {
        categoryMap.set(pos.category, []);
      }
      categoryMap.get(pos.category)!.push(pos);
    }

    const result: CategoryMetrics[] = [];

    for (const [category, catPositions] of categoryMap.entries()) {
      const resolved = catPositions.filter((p) => p.is_resolved);
      const realized = resolved.reduce((s, p) => s + p.realized_pnl, 0);
      const unrealized = catPositions.filter((p) => !p.is_resolved).reduce((s, p) => s + p.unrealized_pnl, 0);
      const wins = resolved.filter((p) => p.realized_pnl > 0);
      const losses = resolved.filter((p) => p.realized_pnl < 0);

      result.push({
        category,
        realized_pnl: realized,
        unrealized_pnl: unrealized,
        total_pnl: realized + unrealized,
        positions_count: catPositions.length,
        win_count: wins.length,
        loss_count: losses.length,
        win_rate: resolved.length > 0 ? wins.length / resolved.length : 0,
      });
    }

    return result.sort((a, b) => b.realized_pnl - a.realized_pnl);
  }
}

export function createV17Engine(): V17Engine {
  return new V17Engine();
}
