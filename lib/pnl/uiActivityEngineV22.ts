/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V22 (EXPERIMENTAL)
 * ============================================================================
 *
 * STATUS: EXPERIMENTAL - Testing dual-formula approach from GPT plan
 *
 * DATA SOURCE: pm_unified_ledger_v7
 *
 * KEY CHANGES FROM V20/V21:
 *   1. Explicit source_type splits (CLOB, PayoutRedemption, PositionsMerge)
 *   2. Dual formula based on position state:
 *      - Closed positions (|net_tokens| < 1): pure cash_flow only
 *      - Open resolved: cash_flow + net_tokens * resolution_price
 *      - Open unresolved: cash_flow + net_tokens * 0.5
 *   3. Excludes Deposit/Withdrawal from PnL (funding events, not trading)
 *
 * HYPOTHESIS:
 *   V22 should improve accuracy for wallets with non-CLOB activity by:
 *   - Avoiding double-counting on PayoutRedemption events
 *   - Correctly handling PositionsMerge (which already has USDC in usdc_delta)
 *   - Treating closed positions differently from open positions
 *
 * Terminal: Claude 1
 * Date: 2025-12-04
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV22 {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;

  // Breakdown by position state
  closed_pnl: number;         // Positions with |net_tokens| < 1
  open_resolved_pnl: number;  // Positions with tokens and resolution
  open_unresolved_pnl: number; // Positions with tokens but no resolution

  // Source USDC breakdown
  clob_usdc: number;
  redemption_usdc: number;
  merge_usdc: number;

  // Counts
  total_positions: number;
  closed_positions: number;
  open_resolved_positions: number;
  open_unresolved_positions: number;

  // V20 compat fields
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  total_trades: number;
  markets_traded: number;
  win_rate: number;
  omega_ratio: number;
}

export interface V22QuickResult {
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;

  // Breakdown
  closed_pnl: number;
  open_resolved_pnl: number;
  open_unresolved_pnl: number;

  // Source splits
  clob_usdc: number;
  redemption_usdc: number;
  merge_usdc: number;

  positions: number;
  closed_positions: number;
  open_positions: number;
  resolved: number;
}

// -----------------------------------------------------------------------------
// V22 Quick PnL (for benchmarking)
// -----------------------------------------------------------------------------

export async function calculateV22PnL(wallet: string): Promise<V22QuickResult> {
  const query = `
    WITH
      -- Aggregate by position and source type
      position_data AS (
        SELECT
          condition_id,
          outcome_index,
          sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
          sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
          sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
          sumIf(usdc_delta, source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) AS transfer_usdc,
          sum(token_delta) AS net_tokens,
          any(payout_norm) AS resolution_price,
          count() AS event_count
        FROM pm_unified_ledger_v7
        WHERE lower(wallet_address) = lower('${wallet}')
          AND condition_id IS NOT NULL
          AND condition_id != ''
          -- Exclude funding events - they're not trading PnL
          AND source_type NOT IN ('Deposit', 'Withdrawal')
        GROUP BY condition_id, outcome_index
      ),
      -- Classify positions and calculate PnL
      position_pnl AS (
        SELECT
          condition_id,
          outcome_index,
          clob_usdc,
          redemption_usdc,
          merge_usdc,
          transfer_usdc,
          net_tokens,
          resolution_price,
          event_count,
          -- Trading USDC = CLOB + redemptions + merges (excludes transfers)
          clob_usdc + redemption_usdc + merge_usdc AS trading_usdc,
          -- Position classification
          if(abs(net_tokens) < 1, 1, 0) AS is_closed,
          if(abs(net_tokens) >= 1 AND resolution_price IS NOT NULL, 1, 0) AS is_open_resolved,
          if(abs(net_tokens) >= 1 AND resolution_price IS NULL, 1, 0) AS is_open_unresolved,
          -- PnL by position type (DUAL FORMULA):
          -- Closed positions: pure cash flow (no token valuation needed)
          if(abs(net_tokens) < 1,
             clob_usdc + redemption_usdc + merge_usdc,
             0) AS pos_closed_pnl,
          -- Open resolved: cash_flow + net_tokens * resolution_price
          if(abs(net_tokens) >= 1 AND resolution_price IS NOT NULL,
             clob_usdc + redemption_usdc + merge_usdc + net_tokens * resolution_price,
             0) AS pos_open_resolved_pnl,
          -- Open unresolved: cash_flow + net_tokens * 0.5
          if(abs(net_tokens) >= 1 AND resolution_price IS NULL,
             clob_usdc + redemption_usdc + merge_usdc + net_tokens * 0.5,
             0) AS pos_open_unresolved_pnl
        FROM position_data
      )
    SELECT
      -- Total PnL components
      sum(pos_closed_pnl) AS closed_pnl,
      sum(pos_open_resolved_pnl) AS open_resolved_pnl,
      sum(pos_open_unresolved_pnl) AS open_unresolved_pnl,
      sum(pos_closed_pnl) + sum(pos_open_resolved_pnl) AS realized_pnl,
      sum(pos_open_unresolved_pnl) AS unrealized_pnl,
      sum(pos_closed_pnl) + sum(pos_open_resolved_pnl) + sum(pos_open_unresolved_pnl) AS total_pnl,

      -- Source USDC totals
      sum(clob_usdc) AS clob_usdc,
      sum(redemption_usdc) AS redemption_usdc,
      sum(merge_usdc) AS merge_usdc,

      -- Counts
      count() AS position_count,
      sumIf(1, is_closed = 1) AS closed_positions,
      sumIf(1, is_open_resolved = 1 OR is_open_unresolved = 1) AS open_positions,
      sumIf(1, resolution_price IS NOT NULL) AS resolved_count
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return {
      total_pnl: 0,
      realized_pnl: 0,
      unrealized_pnl: 0,
      closed_pnl: 0,
      open_resolved_pnl: 0,
      open_unresolved_pnl: 0,
      clob_usdc: 0,
      redemption_usdc: 0,
      merge_usdc: 0,
      positions: 0,
      closed_positions: 0,
      open_positions: 0,
      resolved: 0,
    };
  }

  const r = rows[0];
  return {
    total_pnl: Number(r.total_pnl) || 0,
    realized_pnl: Number(r.realized_pnl) || 0,
    unrealized_pnl: Number(r.unrealized_pnl) || 0,
    closed_pnl: Number(r.closed_pnl) || 0,
    open_resolved_pnl: Number(r.open_resolved_pnl) || 0,
    open_unresolved_pnl: Number(r.open_unresolved_pnl) || 0,
    clob_usdc: Number(r.clob_usdc) || 0,
    redemption_usdc: Number(r.redemption_usdc) || 0,
    merge_usdc: Number(r.merge_usdc) || 0,
    positions: Number(r.position_count) || 0,
    closed_positions: Number(r.closed_positions) || 0,
    open_positions: Number(r.open_positions) || 0,
    resolved: Number(r.resolved_count) || 0,
  };
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

function calculateOmegaRatio(gains: number, losses: number): number {
  if (losses === 0) return gains > 0 ? 100 : 1;
  return gains / Math.abs(losses);
}

// -----------------------------------------------------------------------------
// Full V22 Engine
// -----------------------------------------------------------------------------

interface PositionAggV22 {
  condition_id: string;
  outcome_index: number;
  clob_usdc: number;
  redemption_usdc: number;
  merge_usdc: number;
  transfer_usdc: number;
  net_tokens: number;
  resolution_price: number | null;
  event_count: number;
}

async function loadPositionAggregatesV22(wallet: string): Promise<PositionAggV22[]> {
  const query = `
    SELECT
      condition_id,
      outcome_index,
      sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
      sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
      sumIf(usdc_delta, source_type IN ('ERC1155_Transfer', 'CTF_Transfer')) AS transfer_usdc,
      sum(token_delta) AS net_tokens,
      any(payout_norm) AS resolution_price,
      count() AS event_count
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
      AND source_type NOT IN ('Deposit', 'Withdrawal')
    GROUP BY condition_id, outcome_index
    ORDER BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: Number(r.outcome_index),
    clob_usdc: Number(r.clob_usdc) || 0,
    redemption_usdc: Number(r.redemption_usdc) || 0,
    merge_usdc: Number(r.merge_usdc) || 0,
    transfer_usdc: Number(r.transfer_usdc) || 0,
    net_tokens: Number(r.net_tokens) || 0,
    resolution_price: r.resolution_price !== null ? Number(r.resolution_price) : null,
    event_count: Number(r.event_count) || 0,
  }));
}

class V22Engine {
  async compute(wallet: string): Promise<WalletMetricsV22> {
    const aggregates = await loadPositionAggregatesV22(wallet);

    const marketsSet = new Set<string>();

    let closed_pnl = 0;
    let open_resolved_pnl = 0;
    let open_unresolved_pnl = 0;

    let closed_positions = 0;
    let open_resolved_positions = 0;
    let open_unresolved_positions = 0;

    let clob_usdc = 0;
    let redemption_usdc = 0;
    let merge_usdc = 0;

    let total_gain = 0;
    let total_loss = 0;
    let volume_traded = 0;
    let total_trades = 0;
    let win_count = 0;
    let loss_count = 0;

    for (const agg of aggregates) {
      marketsSet.add(agg.condition_id);
      total_trades += agg.event_count;
      volume_traded += Math.abs(agg.clob_usdc);

      clob_usdc += agg.clob_usdc;
      redemption_usdc += agg.redemption_usdc;
      merge_usdc += agg.merge_usdc;

      const tradingUsdc = agg.clob_usdc + agg.redemption_usdc + agg.merge_usdc;
      const isClosed = Math.abs(agg.net_tokens) < 1;
      const isResolved = agg.resolution_price !== null;

      let positionPnl = 0;

      if (isClosed) {
        // Closed position: pure cash flow
        positionPnl = tradingUsdc;
        closed_pnl += positionPnl;
        closed_positions++;
      } else if (isResolved) {
        // Open but resolved: cash_flow + tokens * resolution
        positionPnl = tradingUsdc + agg.net_tokens * agg.resolution_price!;
        open_resolved_pnl += positionPnl;
        open_resolved_positions++;
      } else {
        // Open and unresolved: mark at 0.5
        positionPnl = tradingUsdc + agg.net_tokens * 0.5;
        open_unresolved_pnl += positionPnl;
        open_unresolved_positions++;
      }

      // Win/loss tracking (only for realized positions)
      if (isClosed || isResolved) {
        if (positionPnl > 0) {
          win_count++;
          total_gain += positionPnl;
        } else if (positionPnl < 0) {
          loss_count++;
          total_loss += positionPnl;
        }
      }
    }

    const resolvedCount = win_count + loss_count;
    const win_rate = resolvedCount > 0 ? win_count / resolvedCount : 0;
    const omega_ratio = calculateOmegaRatio(total_gain, total_loss);

    const realized_pnl = closed_pnl + open_resolved_pnl;
    const unrealized_pnl = open_unresolved_pnl;
    const total_pnl = realized_pnl + unrealized_pnl;

    return {
      wallet,
      realized_pnl: Math.round(realized_pnl * 100) / 100,
      unrealized_pnl: Math.round(unrealized_pnl * 100) / 100,
      total_pnl: Math.round(total_pnl * 100) / 100,
      closed_pnl: Math.round(closed_pnl * 100) / 100,
      open_resolved_pnl: Math.round(open_resolved_pnl * 100) / 100,
      open_unresolved_pnl: Math.round(open_unresolved_pnl * 100) / 100,
      clob_usdc: Math.round(clob_usdc * 100) / 100,
      redemption_usdc: Math.round(redemption_usdc * 100) / 100,
      merge_usdc: Math.round(merge_usdc * 100) / 100,
      total_positions: aggregates.length,
      closed_positions,
      open_resolved_positions,
      open_unresolved_positions,
      total_gain: Math.round(total_gain * 100) / 100,
      total_loss: Math.round(total_loss * 100) / 100,
      volume_traded: Math.round(volume_traded * 100) / 100,
      total_trades,
      markets_traded: marketsSet.size,
      win_rate: Math.round(win_rate * 10000) / 10000,
      omega_ratio: Math.round(omega_ratio * 100) / 100,
    };
  }
}

export function createV22Engine(): V22Engine {
  return new V22Engine();
}
