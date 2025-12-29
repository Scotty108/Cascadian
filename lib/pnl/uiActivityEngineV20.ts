/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V20b (CANONICAL)
 * ============================================================================
 *
 * STATUS: CANONICAL - This is the production PnL engine for Cascadian v1
 *
 * DATA SOURCE: pm_unified_ledger_v9_clob_tbl (CLOB trades with pm_token_to_condition_map_v4)
 *
 * HISTORY:
 *   - 2025-12-15: Fixed to use v9_clob_tbl (was pointing at empty v7)
 *   - 2025-12-15 V20b: Added wallet-scoped dedupe + external inventory clamp
 *
 * V20b IMPROVEMENTS:
 *   1. Wallet-scoped dedupe by event_id (fixes ingestion dupes causing 1.2-3x overcount)
 *   2. External inventory clamp: sells are clamped to available position
 *      (can't sell tokens acquired outside CLOB - phantom profit fix)
 *   3. Proportional scaling of usdc_delta when sells are clamped
 *
 * SCOPE:
 *   - CLOB trades only (source_type = 'CLOB')
 *   - Realized PnL on resolved/settled markets
 *   - Unrealized PnL estimated at 0.5 mark price for open positions
 *
 * FORMULA:
 *   - Resolved:   realized_pnl = cash_flow_clamped + (final_tokens_clamped * resolution_price)
 *   - Unresolved: unrealized_pnl = cash_flow_clamped + (final_tokens_clamped * 0.5)
 *
 * VALIDATION TARGET:
 *   - Within 1% for most CLOB-only wallets
 *   - Within 2% for high-activity wallets
 *   - Outliers flagged as "needs CTF/1155 coverage"
 *
 * NOT COVERED (future V21+):
 *   - LP/AMM positions
 *   - CTF transfers outside CLOB
 *   - Live mark-to-market unrealized PnL
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV20 {
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
// V20 Quick PnL (for benchmarking)
// -----------------------------------------------------------------------------

export async function calculateV20PnL(wallet: string): Promise<{
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: number;
  resolved: number;
}> {
  // V20b: Wallet-scoped dedupe + external inventory clamp
  // 1. Dedupe by event_id (ingestion dupes)
  // 2. Track running position per (condition_id, outcome_index)
  // 3. Clamp sells to available position (external inventory)
  // 4. Scale usdc_delta proportionally
  const query = `
    WITH
      -- Step 1: Wallet-scoped dedupe by event_id
      dedup AS (
        SELECT
          event_id,
          any(condition_id) AS cid,
          any(outcome_index) AS oidx,
          any(usdc_delta) AS usdc,
          any(token_delta) AS tokens,
          any(payout_norm) AS resolution,
          any(event_time) AS etime
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY event_id
      ),
      -- Step 2: Track position before each trade using window function
      ordered AS (
        SELECT
          cid,
          oidx,
          usdc,
          tokens,
          resolution,
          etime,
          event_id,
          coalesce(sum(tokens) OVER (
            PARTITION BY cid, oidx
            ORDER BY etime, event_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS pos_before
        FROM dedup
      ),
      -- Step 3: Clamp sells to available position
      clamped AS (
        SELECT
          cid,
          oidx,
          resolution,
          tokens,
          usdc,
          pos_before,
          -- Clamp sells: can't sell more than we have
          if(tokens < 0,
            greatest(tokens, -greatest(pos_before, 0)),
            tokens
          ) AS token_delta_eff,
          -- Scale proceeds proportionally to clamped amount
          if(tokens < 0 AND tokens != 0,
            usdc * (greatest(tokens, -greatest(pos_before, 0)) / tokens),
            usdc
          ) AS usdc_delta_eff
        FROM ordered
      ),
      -- Step 4: Aggregate to positions
      positions AS (
        SELECT
          cid AS condition_id,
          oidx AS outcome_index,
          sum(usdc_delta_eff) AS cash_flow,
          sum(token_delta_eff) AS final_tokens,
          any(resolution) AS resolution_price
        FROM clamped
        GROUP BY cid, oidx
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
// Full V20 Engine
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
  // V20b: Same dedupe + clamp logic as calculateV20PnL
  const query = `
    WITH
      -- Step 1: Wallet-scoped dedupe by event_id
      dedup AS (
        SELECT
          event_id,
          any(condition_id) AS cid,
          any(outcome_index) AS oidx,
          any(usdc_delta) AS usdc,
          any(token_delta) AS tokens,
          any(payout_norm) AS resolution,
          any(event_time) AS etime
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY event_id
      ),
      -- Step 2: Track position before each trade
      ordered AS (
        SELECT
          cid,
          oidx,
          usdc,
          tokens,
          resolution,
          etime,
          event_id,
          coalesce(sum(tokens) OVER (
            PARTITION BY cid, oidx
            ORDER BY etime, event_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS pos_before
        FROM dedup
      ),
      -- Step 3: Clamp sells to available position
      clamped AS (
        SELECT
          cid,
          oidx,
          resolution,
          -- Clamp sells: can't sell more than we have
          if(tokens < 0,
            greatest(tokens, -greatest(pos_before, 0)),
            tokens
          ) AS token_delta_eff,
          -- Scale proceeds proportionally
          if(tokens < 0 AND tokens != 0,
            usdc * (greatest(tokens, -greatest(pos_before, 0)) / tokens),
            usdc
          ) AS usdc_delta_eff
        FROM ordered
      ),
      -- Step 4: Aggregate to positions
      ledger_agg AS (
        SELECT
          cid AS condition_id,
          oidx AS outcome_index,
          sum(usdc_delta_eff) AS cash_flow,
          sum(token_delta_eff) AS final_tokens,
          any(resolution) AS resolution_price,
          count() as trade_count
        FROM clamped
        GROUP BY cid, oidx
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

class V20Engine {
  async compute(wallet: string): Promise<WalletMetricsV20> {
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

export function createV20Engine(): V20Engine {
  return new V20Engine();
}
