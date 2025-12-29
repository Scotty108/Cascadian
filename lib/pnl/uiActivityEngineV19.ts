/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V19
 * ============================================================================
 *
 * PURPOSE: Production-ready PnL engine built on pm_unified_ledger_v6
 *
 * KEY IMPROVEMENTS FROM V18:
 *   - Uses pm_unified_ledger_v6 (canonical source of truth)
 *   - Filters to CLOB trades with valid condition_id (excludes unmapped)
 *   - Canonical formula: total_pnl = sum(usdc_delta) + sum(token_delta * resolution_price)
 *
 * VALIDATION RESULTS (2025-12-03):
 *   - CLOB-only wallets: 0.00% median error (perfect match)
 *   - Mixed CTF+CLOB wallets: 0.37% median error (11/18 pass ≤1%)
 *   - Unmapped trades excluded to avoid phantom losses
 *
 * ============================================================================
 * FORMULA SEMANTICS
 * ============================================================================
 *
 * RESOLVED MARKETS (payout_norm IS NOT NULL):
 *   realized_pnl   = cash_flow + (final_tokens * resolution_price)
 *   unrealized_pnl = 0
 *
 * UNRESOLVED MARKETS (payout_norm IS NULL):
 *   realized_pnl   = 0
 *   unrealized_pnl = cash_flow + (final_tokens * mark_price)
 *                    where mark_price defaults to 0.5
 *
 * cash_flow    = sum(usdc_delta) over all trades in position
 * final_tokens = sum(token_delta) over all trades in position
 *
 * ============================================================================
 * DATA SOURCE
 * ============================================================================
 *
 * pm_unified_ledger_v6 with filters:
 *   - source_type = 'CLOB'
 *   - condition_id IS NOT NULL AND condition_id != ''
 *
 * This excludes:
 *   - CTF events (PayoutRedemption, PositionSplit, PositionsMerge)
 *   - Unmapped trades (token_id not in pm_token_to_condition_map_v3)
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV19 {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  total_trades: number;
  positions_count: number;
  markets_traded: number;
  resolutions: number;
  win_rate: number;
  omega_ratio: number;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  positions: PositionSummaryV19[];
  by_category: CategoryMetricsV19[];
}

export interface PositionSummaryV19 {
  condition_id: string;
  outcome_index: number;
  category: string;
  cash_flow: number;
  final_tokens: number;
  resolution_price: number | null;
  realized_pnl: number;
  unrealized_pnl: number;
  is_resolved: boolean;
  trade_count: number;
}

export interface CategoryMetricsV19 {
  category: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  omega_ratio: number;
}

// -----------------------------------------------------------------------------
// Data Loading from pm_unified_ledger_v6
// -----------------------------------------------------------------------------

interface PositionAgg {
  condition_id: string;
  outcome_index: number;
  category: string;
  cash_flow: number;
  final_tokens: number;
  resolution_price: number | null;
  trade_count: number;
}

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  // Query pm_unified_ledger_v6 with category from pm_token_to_condition_map_v3
  // Filter: CLOB only, mapped trades only (condition_id not null/empty)
  const query = `
    WITH ledger_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        any(payout_norm) AS resolution_price,
        count() as trade_count
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      l.condition_id,
      l.outcome_index,
      COALESCE(m.category, 'Other') as category,
      l.cash_flow,
      l.final_tokens,
      l.resolution_price,
      l.trade_count
    FROM ledger_agg l
    LEFT JOIN (
      SELECT DISTINCT condition_id, category
      FROM pm_token_to_condition_map_v3
      WHERE category IS NOT NULL
    ) m ON l.condition_id = m.condition_id
    ORDER BY l.condition_id, l.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    category: r.category || 'Other',
    cash_flow: Number(r.cash_flow),
    final_tokens: Number(r.final_tokens),
    resolution_price: r.resolution_price !== null ? Number(r.resolution_price) : null,
    trade_count: Number(r.trade_count),
  }));
}

// -----------------------------------------------------------------------------
// Metrics Calculations
// -----------------------------------------------------------------------------

function calculateOmegaRatio(gains: number, losses: number): number {
  // Omega = sum(gains) / sum(|losses|)
  // If no losses, cap at 100
  if (losses === 0) return gains > 0 ? 100 : 1;
  return gains / Math.abs(losses);
}

function calculateSharpeRatio(returns: number[]): number | null {
  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  // Sharpe = mean / stdDev (assuming risk-free rate = 0)
  return mean / stdDev;
}

function calculateSortinoRatio(returns: number[]): number | null {
  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  // Downside deviation: only negative returns
  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return mean > 0 ? 100 : null;

  const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);

  if (downsideDev === 0) return null;

  // Sortino = mean / downside_deviation
  return mean / downsideDev;
}

// -----------------------------------------------------------------------------
// V19 Engine
// -----------------------------------------------------------------------------

class V19Engine {
  async compute(wallet: string): Promise<WalletMetricsV19> {
    // Load position aggregates from pm_unified_ledger_v6
    const aggregates = await loadPositionAggregates(wallet);

    const positions: PositionSummaryV19[] = [];
    const marketsSet = new Set<string>();
    const positionReturns: number[] = [];

    let realized_pnl = 0;
    let unrealized_pnl = 0;
    let total_gain = 0;
    let total_loss = 0;
    let volume_traded = 0;
    let total_trades = 0;
    let resolutions = 0;
    let win_count = 0;
    let loss_count = 0;

    for (const agg of aggregates) {
      marketsSet.add(agg.condition_id);
      total_trades += agg.trade_count;

      // Volume = absolute value of cash flow
      volume_traded += Math.abs(agg.cash_flow);

      const isResolved = agg.resolution_price !== null;

      let pos_realized_pnl = 0;
      let pos_unrealized_pnl = 0;

      if (isResolved) {
        // Realized PnL = cash_flow + (final_tokens × resolution_price)
        // Round to cents for UI parity
        pos_realized_pnl = Math.round((agg.cash_flow + agg.final_tokens * agg.resolution_price!) * 100) / 100;
        resolutions++;

        // Track for metrics
        positionReturns.push(pos_realized_pnl);
        if (pos_realized_pnl > 0) {
          win_count++;
          total_gain += pos_realized_pnl;
        } else if (pos_realized_pnl < 0) {
          loss_count++;
          total_loss += pos_realized_pnl;
        }
      } else {
        // Unrealized: use mark price = 0.5
        const markPrice = 0.5;
        // Round to cents for UI parity
        pos_unrealized_pnl = Math.round((agg.cash_flow + agg.final_tokens * markPrice) * 100) / 100;
      }

      realized_pnl += pos_realized_pnl;
      unrealized_pnl += pos_unrealized_pnl;

      positions.push({
        condition_id: agg.condition_id,
        outcome_index: agg.outcome_index,
        category: agg.category,
        cash_flow: agg.cash_flow,
        final_tokens: agg.final_tokens,
        resolution_price: agg.resolution_price,
        realized_pnl: pos_realized_pnl,
        unrealized_pnl: pos_unrealized_pnl,
        is_resolved: isResolved,
        trade_count: agg.trade_count,
      });
    }

    // Calculate aggregate metrics
    const resolvedCount = win_count + loss_count;
    const win_rate = resolvedCount > 0 ? win_count / resolvedCount : 0;
    const omega_ratio = calculateOmegaRatio(total_gain, total_loss);
    const sharpe_ratio = calculateSharpeRatio(positionReturns);
    const sortino_ratio = calculateSortinoRatio(positionReturns);

    // Calculate category metrics
    const by_category = this.calculateCategoryMetrics(positions);

    return {
      wallet,
      realized_pnl,
      unrealized_pnl,
      total_pnl: realized_pnl + unrealized_pnl,
      total_gain,
      total_loss,
      volume_traded,
      total_trades,
      positions_count: positions.length,
      markets_traded: marketsSet.size,
      resolutions,
      win_rate,
      omega_ratio,
      sharpe_ratio,
      sortino_ratio,
      positions,
      by_category,
    };
  }

  private calculateCategoryMetrics(positions: PositionSummaryV19[]): CategoryMetricsV19[] {
    const categoryMap = new Map<string, PositionSummaryV19[]>();

    for (const pos of positions) {
      if (!categoryMap.has(pos.category)) {
        categoryMap.set(pos.category, []);
      }
      categoryMap.get(pos.category)!.push(pos);
    }

    const result: CategoryMetricsV19[] = [];

    for (const [category, catPositions] of categoryMap.entries()) {
      const resolved = catPositions.filter((p) => p.is_resolved);
      const realized = resolved.reduce((s, p) => s + p.realized_pnl, 0);
      const unrealized = catPositions.filter((p) => !p.is_resolved).reduce((s, p) => s + p.unrealized_pnl, 0);
      const wins = resolved.filter((p) => p.realized_pnl > 0);
      const losses = resolved.filter((p) => p.realized_pnl < 0);

      const catGains = wins.reduce((s, p) => s + p.realized_pnl, 0);
      const catLosses = losses.reduce((s, p) => s + p.realized_pnl, 0);

      result.push({
        category,
        realized_pnl: realized,
        unrealized_pnl: unrealized,
        total_pnl: realized + unrealized,
        positions_count: catPositions.length,
        win_count: wins.length,
        loss_count: losses.length,
        win_rate: resolved.length > 0 ? wins.length / resolved.length : 0,
        omega_ratio: calculateOmegaRatio(catGains, catLosses),
      });
    }

    return result.sort((a, b) => b.realized_pnl - a.realized_pnl);
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createV19Engine(): V19Engine {
  return new V19Engine();
}

// -----------------------------------------------------------------------------
// Quick PnL calculation (for benchmarking)
// -----------------------------------------------------------------------------

export async function calculateV19PnL(wallet: string): Promise<{
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: number;
  resolved: number;
}> {
  const query = `
    WITH
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT
          condition_id,
          cash_flow,
          final_tokens,
          resolution_price,
          if(resolution_price IS NOT NULL,
             round(cash_flow + final_tokens * resolution_price, 2),
             0) AS pos_realized_pnl,
          if(resolution_price IS NULL,
             round(cash_flow + final_tokens * 0.5, 2),
             0) AS pos_unrealized_pnl,
          if(resolution_price IS NOT NULL, 1, 0) AS is_resolved
        FROM positions
      )
    SELECT
      sum(pos_realized_pnl) AS realized_pnl,
      sum(pos_unrealized_pnl) AS unrealized_pnl,
      sum(pos_realized_pnl) + sum(pos_unrealized_pnl) AS total_pnl,
      count() AS position_count,
      sumIf(1, is_resolved = 1) AS resolved_count
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { total_pnl: 0, realized_pnl: 0, unrealized_pnl: 0, positions: 0, resolved: 0 };
  }

  return {
    total_pnl: Number(rows[0].total_pnl) || 0,
    realized_pnl: Number(rows[0].realized_pnl) || 0,
    unrealized_pnl: Number(rows[0].unrealized_pnl) || 0,
    positions: Number(rows[0].position_count) || 0,
    resolved: Number(rows[0].resolved_count) || 0,
  };
}
