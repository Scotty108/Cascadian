/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V21
 * ============================================================================
 *
 * PURPOSE: Fixed PnL engine with condition_id normalization
 *
 * KEY FIX FROM V20:
 *   - Normalizes condition_id by stripping '0x' prefix for consistent grouping
 *   - CLOB rows have '0x' prefix, PayoutRedemption rows don't
 *   - This was causing positions to be double-counted/miscalculated
 *
 * FORMULA:
 *   - Realized PnL = sum(all usdc_delta) for positions with resolution
 *   - Unrealized PnL = sum(usdc_delta) + net_tokens * mark_price for open positions
 *   - Total PnL = Realized + Unrealized
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV21 {
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
}

// -----------------------------------------------------------------------------
// V21 Quick PnL (for benchmarking)
// -----------------------------------------------------------------------------

export async function calculateV21PnL(wallet: string): Promise<{
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: number;
  resolved: number;
}> {
  // The key fix: normalize condition_id by stripping 0x prefix
  // Then properly aggregate CLOB + PayoutRedemption for same market
  const query = `
    WITH
      -- Normalize condition_id by stripping 0x prefix
      normalized_ledger AS (
        SELECT
          lower(replaceOne(condition_id, '0x', '')) as norm_condition_id,
          outcome_index,
          source_type,
          usdc_delta,
          token_delta,
          payout_numerators,
          payout_norm
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
      ),
      -- Aggregate by normalized condition_id
      positions AS (
        SELECT
          norm_condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS net_tokens,
          -- Get resolution info from PayoutRedemption rows (they have payout data)
          maxIf(payout_norm, payout_norm > 0) AS resolution_price,
          countIf(source_type = 'PayoutRedemption') AS redemption_count
        FROM normalized_ledger
        GROUP BY norm_condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT
          norm_condition_id,
          cash_flow,
          net_tokens,
          resolution_price,
          redemption_count,
          -- If there's been a redemption, the position is resolved
          -- The cash_flow already includes the redemption payout
          if(redemption_count > 0,
             cash_flow,  -- Realized = just the net cash flow (buys + sells + redemptions)
             0) AS pos_realized_pnl,
          -- Unrealized: positions with no redemptions
          if(redemption_count = 0,
             cash_flow + net_tokens * 0.5,  -- Mark to market at 50c
             0) AS pos_unrealized_pnl,
          if(redemption_count > 0, 1, 0) AS is_resolved
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

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

function calculateOmegaRatio(gains: number, losses: number): number {
  if (losses === 0) return gains > 0 ? 100 : 1;
  return gains / Math.abs(losses);
}

function calculateSharpeRatio(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;
  return mean / stdDev;
}

function calculateSortinoRatio(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return mean > 0 ? 100 : null;
  const downsideVariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);
  if (downsideDev === 0) return null;
  return mean / downsideDev;
}

// -----------------------------------------------------------------------------
// Full V21 Engine
// -----------------------------------------------------------------------------

interface PositionAgg {
  norm_condition_id: string;
  outcome_index: number;
  category: string;
  cash_flow: number;
  net_tokens: number;
  is_resolved: boolean;
  trade_count: number;
}

async function loadPositionAggregates(wallet: string): Promise<PositionAgg[]> {
  const query = `
    WITH normalized_ledger AS (
      SELECT
        lower(replaceOne(condition_id, '0x', '')) as norm_condition_id,
        outcome_index,
        source_type,
        usdc_delta,
        token_delta
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    ledger_agg AS (
      SELECT
        norm_condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS net_tokens,
        countIf(source_type = 'PayoutRedemption') AS redemption_count,
        count() as trade_count
      FROM normalized_ledger
      GROUP BY norm_condition_id, outcome_index
    )
    SELECT
      l.norm_condition_id,
      l.outcome_index,
      COALESCE(m.category, 'Other') as category,
      l.cash_flow,
      l.net_tokens,
      l.redemption_count > 0 as is_resolved,
      l.trade_count
    FROM ledger_agg l
    LEFT JOIN (
      SELECT DISTINCT
        lower(replaceOne(condition_id, '0x', '')) as norm_condition_id,
        category
      FROM pm_token_to_condition_map_v4
      WHERE category IS NOT NULL
    ) m ON l.norm_condition_id = m.norm_condition_id
    ORDER BY l.norm_condition_id, l.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    norm_condition_id: r.norm_condition_id,
    outcome_index: Number(r.outcome_index),
    category: r.category || 'Other',
    cash_flow: Number(r.cash_flow),
    net_tokens: Number(r.net_tokens),
    is_resolved: Boolean(r.is_resolved),
    trade_count: Number(r.trade_count),
  }));
}

class V21Engine {
  async compute(wallet: string): Promise<WalletMetricsV21> {
    const aggregates = await loadPositionAggregates(wallet);

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
      marketsSet.add(agg.norm_condition_id);
      total_trades += agg.trade_count;
      volume_traded += Math.abs(agg.cash_flow);

      let pos_realized_pnl = 0;
      let pos_unrealized_pnl = 0;

      if (agg.is_resolved) {
        // Resolved position: PnL is just the net cash flow
        // (buys subtract USDC, sells add USDC, redemptions add USDC)
        pos_realized_pnl = Math.round(agg.cash_flow * 100) / 100;
        resolutions++;
        positionReturns.push(pos_realized_pnl);
        if (pos_realized_pnl > 0) {
          win_count++;
          total_gain += pos_realized_pnl;
        } else if (pos_realized_pnl < 0) {
          loss_count++;
          total_loss += pos_realized_pnl;
        }
      } else {
        // Unrealized position: mark to market at 50c
        const markPrice = 0.5;
        pos_unrealized_pnl = Math.round((agg.cash_flow + agg.net_tokens * markPrice) * 100) / 100;
      }

      realized_pnl += pos_realized_pnl;
      unrealized_pnl += pos_unrealized_pnl;
    }

    const resolvedCount = win_count + loss_count;
    const win_rate = resolvedCount > 0 ? win_count / resolvedCount : 0;
    const omega_ratio = calculateOmegaRatio(total_gain, total_loss);
    const sharpe_ratio = calculateSharpeRatio(positionReturns);
    const sortino_ratio = calculateSortinoRatio(positionReturns);

    return {
      wallet,
      realized_pnl,
      unrealized_pnl,
      total_pnl: realized_pnl + unrealized_pnl,
      total_gain,
      total_loss,
      volume_traded,
      total_trades,
      positions_count: aggregates.length,
      markets_traded: marketsSet.size,
      resolutions,
      win_rate,
      omega_ratio,
      sharpe_ratio,
      sortino_ratio,
    };
  }
}

export function createV21Engine(): V21Engine {
  return new V21Engine();
}
