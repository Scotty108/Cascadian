/**
 * ============================================================================
 * POLYMARKET UI PARITY ENGINE - V18
 * ============================================================================
 *
 * PURPOSE: Match Polymarket's profile page PnL display exactly.
 *
 * KEY DIFFERENCE FROM V17:
 *   V18 filters trades to role = 'maker' ONLY.
 *   Polymarket UI attributes PnL to the maker side of each trade.
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
 * FORMULA COMPONENTS (same as V17)
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
 * ROUNDING (John at Goldsky)
 * ============================================================================
 *
 * "The UI is showing a rounded version of the price in cents, the subgraph
 * data has sub-cent accuracy, so if you use the full value, or round it,
 * when multiplying that by large numbers it definitely causes a significant
 * difference."
 *
 * Implementation: Round per-position PnL to cents (2 decimal places) before
 * summing. This matches UI behavior and eliminates floating-point accumulation.
 *
 * ============================================================================
 * VALIDATION STATUS
 * ============================================================================
 *
 * - Wallet 0xaa0ecadc...: V18 matches UI exactly (0.0% error)
 * - Phase 4 fresh wallets: 4/6 within 5%, 5/6 within 25%
 * - Phase 4 legacy wallets: median error 12% (down from 75% in V17)
 * - Post-rounding: Clean CLOB-only wallets achieve exact match
 *
 * ============================================================================
 * HISTORY
 * ============================================================================
 *
 * V17: All roles (maker + taker) - Cascadian canonical PnL
 * V18: Maker only - Polymarket UI parity mode (2025-12-03)
 * V18.1: Added per-position rounding to cents for UI parity (2025-12-03)
 *
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV18 {
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
  positions: PositionSummaryV18[];
  by_category: CategoryMetrics[];
}

export interface PositionSummaryV18 {
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
  // Aggregate trades by (condition_id, outcome_index)
  // Use dedup pattern for pm_trader_events_v2
  // V18: Filter to role = 'maker' only for UI parity
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'  -- V18: Maker only for UI parity
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      COALESCE(m.category, 'Other') as category,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END) as buy_tokens,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END) as sell_tokens,
      sum(CASE WHEN d.side = 'buy' THEN abs(d.usdc) ELSE 0 END) as buy_usdc,
      sum(CASE WHEN d.side = 'sell' THEN abs(d.usdc) ELSE 0 END) as sell_usdc,
      count() as trade_count
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, m.category
    ORDER BY m.condition_id, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    category: r.category || 'Other',
    buy_tokens: Number(r.buy_tokens),
    sell_tokens: Number(r.sell_tokens),
    buy_usdc: Number(r.buy_usdc),
    sell_usdc: Number(r.sell_usdc),
    trade_count: Number(r.trade_count),
  }));
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
// V18 Engine (UI Parity - Maker Only)
// -----------------------------------------------------------------------------

class V18Engine {
  private resolutionCache: Map<string, Resolution> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV18> {
    // Load position aggregates
    const aggregates = await loadPositionAggregates(wallet);

    // Load resolutions
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    const positions: PositionSummaryV18[] = [];
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
        // Round to cents for UI parity (John at Goldsky: UI rounds prices to cents)
        pos_realized_pnl = Math.round((trade_cash_flow + final_shares * resolution_price) * 100) / 100;
        resolutions++;
      } else {
        // Unrealized: use current price estimate (0.5)
        const currentPrice = 0.5;
        // Round to cents for UI parity
        pos_unrealized_pnl = Math.round((trade_cash_flow + final_shares * currentPrice) * 100) / 100;
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

  private calculateCategoryMetrics(positions: PositionSummaryV18[]): CategoryMetrics[] {
    const categoryMap = new Map<string, PositionSummaryV18[]>();

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

export function createV18Engine(): V18Engine {
  return new V18Engine();
}
