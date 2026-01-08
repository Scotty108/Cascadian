/**
 * ============================================================================
 * POLYMARKET UI-PARITY PNL ENGINE - V17 UI MODE
 * ============================================================================
 *
 * This engine uses the SAME FORMULA as V17 but with MAKER-ONLY attribution.
 *
 * ============================================================================
 * PURPOSE
 * ============================================================================
 *
 * Phase 3 of the PnL investigation discovered that Polymarket's UI PnL
 * appears to use maker-only trade attribution. When we filter our
 * pm_trader_events_v3 trades to role='maker', 5 of 6 benchmark wallets
 * match the UI exactly.
 *
 * This engine is a thin wrapper that:
 * 1. Loads trades filtered to role='maker' only
 * 2. Uses the identical V17 formula for PnL calculation
 * 3. Returns the same WalletMetricsV17 structure
 *
 * ============================================================================
 * WHEN TO USE
 * ============================================================================
 *
 * - Use V17 (canonical) for: Cascadian internal metrics, "Profit" display
 * - Use V17UiMode for: "Polymarket UI Profit" comparison, UI parity testing
 *
 * ============================================================================
 * RELATIONSHIP TO V17
 * ============================================================================
 *
 * V17 is FROZEN and unchanged. This file is a separate entry point that
 * calls the same math logic but with pre-filtered data.
 *
 */

import { clickhouse } from '../clickhouse/client';

// Re-export V17 types for consistency
export type {
  WalletMetricsV17,
  PositionSummaryV17,
  CategoryMetrics,
} from './uiActivityEngineV17';

import type {
  WalletMetricsV17,
  PositionSummaryV17,
  CategoryMetrics,
} from './uiActivityEngineV17';

// -----------------------------------------------------------------------------
// Data Loading - MAKER-ONLY Aggregation
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

/**
 * Load position aggregates filtered to MAKER trades only.
 * This is the key difference from canonical V17.
 */
async function loadMakerOnlyPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  // Aggregate trades by (condition_id, outcome_index)
  // CRITICAL: role = 'maker' filter applied BEFORE deduplication
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND role = 'maker'  -- UI MODE: MAKER ONLY
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
// V17 UI Mode Engine
// -----------------------------------------------------------------------------

class V17UiModeEngine {
  private resolutionCache: Map<string, Resolution> | null = null;

  /**
   * Compute PnL using maker-only attribution.
   * Uses the SAME FORMULA as V17, but with pre-filtered trade data.
   */
  async compute(wallet: string): Promise<WalletMetricsV17> {
    // Load position aggregates - MAKER ONLY
    const aggregates = await loadMakerOnlyPositionAggregates(wallet);

    // Load resolutions (same as V17)
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

      // Calculate using the cascadian formula (SAME AS V17)
      const trade_cash_flow = agg.sell_usdc - agg.buy_usdc;
      const final_shares = agg.buy_tokens - agg.sell_tokens;

      // Get resolution info (SAME AS V17)
      const resolution = this.resolutionCache?.get(agg.condition_id);
      const isResolved = !!resolution && resolution.payout_numerators.length > agg.outcome_index;
      const resolution_price = isResolved ? resolution!.payout_numerators[agg.outcome_index] : null;

      let pos_realized_pnl = 0;
      let pos_unrealized_pnl = 0;

      if (isResolved && resolution_price !== null) {
        // Realized PnL = cash_flow + (final_shares × resolution_price) [SAME AS V17]
        pos_realized_pnl = trade_cash_flow + final_shares * resolution_price;
        resolutions++;
      } else {
        // Unrealized: use current price estimate (0.5) [SAME AS V17]
        const currentPrice = 0.5;
        pos_unrealized_pnl = trade_cash_flow + final_shares * currentPrice;
        pos_realized_pnl = 0;
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

    // Calculate category metrics (SAME AS V17)
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

/**
 * Create a V17 UI Mode engine instance.
 * This uses maker-only attribution to match Polymarket UI.
 */
export function createV17UiModeEngine(): V17UiModeEngine {
  return new V17UiModeEngine();
}

/**
 * Convenience function to compute UI-style PnL for a wallet.
 */
export async function calculateMakerOnlyUiPnl(wallet: string): Promise<WalletMetricsV17> {
  const engine = createV17UiModeEngine();
  return engine.compute(wallet);
}
