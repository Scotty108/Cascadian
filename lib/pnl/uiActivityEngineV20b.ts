/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V20b (EXPERIMENTAL)
 * ============================================================================
 *
 * STATUS: EXPERIMENTAL - Testing PayoutRedemption inclusion (CLOB positions only)
 *
 * WHAT'S DIFFERENT FROM V20a:
 *   - V20a: Includes ALL PayoutRedemption events → overcounts for non-CLOB positions
 *   - V20b: Includes PayoutRedemption ONLY for positions that have CLOB trades
 *
 * WHY THIS MATTERS:
 *   Some wallets have PayoutRedemption events for positions acquired via ERC1155
 *   transfer (not CLOB trade). For these positions:
 *   - V20a: Shows pure profit (redemption USDC with no cost basis) → overcounts
 *   - V20b: Excludes them (no CLOB trade, no PnL) → stays accurate
 *
 * FORMULA (same as V20):
 *   - Realized:   cash_flow + (final_tokens * resolution_price)
 *   - Unresolved: cash_flow + (final_tokens * 0.5)
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types (same as V20)
// -----------------------------------------------------------------------------

export interface WalletMetricsV20b {
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
// V20b Quick PnL (for benchmarking)
// -----------------------------------------------------------------------------

export async function calculateV20bPnL(wallet: string): Promise<{
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: number;
  resolved: number;
  redemption_only_positions: number;
}> {
  const query = `
    WITH
      -- First, identify which positions have CLOB trades
      clob_positions AS (
        SELECT DISTINCT condition_id, outcome_index
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
      ),
      -- Count redemption-only positions (for stats)
      redemption_only AS (
        SELECT count(DISTINCT (condition_id, outcome_index)) as cnt
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'PayoutRedemption'
          AND condition_id IS NOT NULL
          AND condition_id != ''
          AND (condition_id, outcome_index) NOT IN (SELECT * FROM clob_positions)
      ),
      -- Aggregate positions: include CLOB events + PayoutRedemption for CLOB positions only
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
          AND (
            source_type = 'CLOB'
            OR (source_type = 'PayoutRedemption' AND (condition_id, outcome_index) IN (SELECT * FROM clob_positions))
          )
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
      sumIf(1, is_resolved = 1) AS resolved_count,
      (SELECT cnt FROM redemption_only) AS redemption_only_positions
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { total_pnl: 0, realized_pnl: 0, unrealized_pnl: 0, positions: 0, resolved: 0, redemption_only_positions: 0 };
  }

  return {
    total_pnl: Number(rows[0].total_pnl) || 0,
    realized_pnl: Number(rows[0].realized_pnl) || 0,
    unrealized_pnl: Number(rows[0].unrealized_pnl) || 0,
    positions: Number(rows[0].position_count) || 0,
    resolved: Number(rows[0].resolved_count) || 0,
    redemption_only_positions: Number(rows[0].redemption_only_positions) || 0,
  };
}

// -----------------------------------------------------------------------------
// Helper Functions (same as V20)
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
// Full V20b Engine
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
  const query = `
    WITH
      -- Identify CLOB positions
      clob_positions AS (
        SELECT DISTINCT condition_id, outcome_index
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
      ),
      ledger_agg AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price,
          count() as trade_count
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
          AND (
            source_type = 'CLOB'
            OR (source_type = 'PayoutRedemption' AND (condition_id, outcome_index) IN (SELECT * FROM clob_positions))
          )
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
      FROM pm_token_to_condition_map_v4
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

class V20bEngine {
  async compute(wallet: string): Promise<WalletMetricsV20b> {
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
      marketsSet.add(agg.condition_id);
      total_trades += agg.trade_count;
      volume_traded += Math.abs(agg.cash_flow);

      const isResolved = agg.resolution_price !== null;
      let pos_realized_pnl = 0;
      let pos_unrealized_pnl = 0;

      if (isResolved) {
        pos_realized_pnl = Math.round((agg.cash_flow + agg.final_tokens * agg.resolution_price!) * 100) / 100;
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
        const markPrice = 0.5;
        pos_unrealized_pnl = Math.round((agg.cash_flow + agg.final_tokens * markPrice) * 100) / 100;
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

export function createV20bEngine(): V20bEngine {
  return new V20bEngine();
}
