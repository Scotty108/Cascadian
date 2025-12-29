/**
 * ============================================================================
 * CASCADIAN PNL ENGINE - V21 (SYNTHETIC RESOLUTIONS + REAL MARK)
 * ============================================================================
 *
 * STATUS: CANONICAL for CLOB-first PnL validation
 *
 * KEY FEATURES:
 *   1. Wallet-scoped dedupe by event_id
 *   2. External inventory clamp (sells clamped to CLOB position)
 *   3. Synthetic resolutions: resolved markets settle at payout_norm
 *   4. Real mark prices from pm_latest_mark_price_v1 (not 0.5 constant)
 *   5. Outputs gain/loss/net to match UI tooltip
 *
 * FORMULA:
 *   position_pnl = cash_flow_eff + (final_tokens_eff * settlement_price)
 *   settlement_price = payout_norm if resolved, else mark_price from latest trades
 *
 * GATING METRICS:
 *   - external_sell_pct: % of sell proceeds from external inventory
 *   - mapped_ratio: % of rows with valid condition_id
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface V21WalletResult {
  wallet: string;

  // PnL components (matches UI tooltip)
  gain: number;      // sum of positive position_pnl
  loss: number;      // sum of negative position_pnl (as positive number)
  net: number;       // gain - loss

  // Breakdown
  realized_pnl: number;     // from resolved positions
  unrealized_pnl: number;   // from unresolved positions

  // Counts
  positions: number;
  resolved_positions: number;
  unresolved_positions: number;
  markets: number;

  // Gating metrics
  external_sell_pct: number;  // % of sell value clamped away
  mapped_ratio: number;       // % of rows with condition_id
  clob_rows: number;

  // Quality flags
  is_clob_only: boolean;      // external_sell_pct <= 0.5%
  is_eligible: boolean;       // meets all gating criteria
}

export interface V21PositionDetail {
  condition_id: string;
  outcome_index: number;
  cash_flow_eff: number;
  final_tokens_eff: number;
  settlement_price: number;
  is_resolved: boolean;
  position_pnl: number;
  trade_count: number;
}

// -----------------------------------------------------------------------------
// Main Engine Function
// -----------------------------------------------------------------------------

export async function calculateV21PnL(wallet: string): Promise<V21WalletResult> {
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
          ) AS usdc_delta_eff,
          -- Track clamp impact for gating
          if(tokens < 0, usdc - if(tokens != 0, usdc * (greatest(tokens, -greatest(pos_before, 0)) / tokens), 0), 0) AS clamp_impact
        FROM ordered
      ),

      -- Step 4: Aggregate to positions with mark prices
      positions AS (
        SELECT
          c.cid AS condition_id,
          c.oidx AS outcome_index,
          sum(c.usdc_delta_eff) AS cash_flow_eff,
          sum(c.token_delta_eff) AS final_tokens_eff,
          any(c.resolution) AS payout_norm,
          count() AS trade_count,
          -- Join mark price for unresolved
          any(mp.mark_price) AS mark_price
        FROM clamped c
        LEFT JOIN pm_latest_mark_price_v1 mp
          ON c.cid = mp.condition_id AND c.oidx = mp.outcome_index
        GROUP BY c.cid, c.oidx
      ),

      -- Step 5: Calculate position PnL with synthetic resolutions
      position_pnl AS (
        SELECT
          condition_id,
          outcome_index,
          cash_flow_eff,
          final_tokens_eff,
          payout_norm,
          mark_price,
          -- Settlement price: resolved -> payout_norm, else -> mark_price (fallback 0.5)
          if(payout_norm IS NOT NULL, payout_norm, coalesce(mark_price, 0.5)) AS settlement_price,
          payout_norm IS NOT NULL AS is_resolved,
          -- Position PnL formula
          round(cash_flow_eff + final_tokens_eff * if(payout_norm IS NOT NULL, payout_norm, coalesce(mark_price, 0.5)), 2) AS pos_pnl,
          trade_count
        FROM positions
      ),

      -- Step 6: Compute gating metrics
      gating AS (
        SELECT
          sumIf(clamp_impact, tokens < 0) AS external_sell_value,
          sumIf(usdc, tokens < 0) AS total_sell_value
        FROM clamped
      )

    SELECT
      -- Aggregates for PnL
      sumIf(pos_pnl, pos_pnl > 0) AS gain,
      sumIf(-pos_pnl, pos_pnl < 0) AS loss,
      sum(pos_pnl) AS net,
      sumIf(pos_pnl, is_resolved) AS realized_pnl,
      sumIf(pos_pnl, NOT is_resolved) AS unrealized_pnl,
      count() AS positions,
      countIf(is_resolved) AS resolved_positions,
      countIf(NOT is_resolved) AS unresolved_positions,
      uniqExact(condition_id) AS markets,
      sum(trade_count) AS total_trades,
      -- Gating metrics from subquery
      (SELECT external_sell_value FROM gating) AS external_sell_value,
      (SELECT total_sell_value FROM gating) AS total_sell_value
    FROM position_pnl
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return createEmptyResult(wallet);
  }

  const r = rows[0];
  const external_sell_pct = r.total_sell_value !== 0
    ? Math.abs(Number(r.external_sell_value) / Number(r.total_sell_value)) * 100
    : 0;

  // Get mapped ratio
  const mappedQuery = `
    SELECT
      count() AS total_rows,
      countIf(condition_id IS NOT NULL AND condition_id != '') AS mapped_rows
    FROM pm_unified_ledger_v9_clob_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND source_type = 'CLOB'
  `;
  const mappedResult = await clickhouse.query({ query: mappedQuery, format: 'JSONEachRow' });
  const mappedRows = (await mappedResult.json() as any[])[0];
  const mapped_ratio = mappedRows.total_rows > 0
    ? (Number(mappedRows.mapped_rows) / Number(mappedRows.total_rows)) * 100
    : 0;

  const is_clob_only = external_sell_pct <= 0.5;
  const is_eligible = is_clob_only && mapped_ratio >= 99.9;

  return {
    wallet,
    gain: Number(r.gain) || 0,
    loss: Number(r.loss) || 0,
    net: Number(r.net) || 0,
    realized_pnl: Number(r.realized_pnl) || 0,
    unrealized_pnl: Number(r.unrealized_pnl) || 0,
    positions: Number(r.positions) || 0,
    resolved_positions: Number(r.resolved_positions) || 0,
    unresolved_positions: Number(r.unresolved_positions) || 0,
    markets: Number(r.markets) || 0,
    external_sell_pct,
    mapped_ratio,
    clob_rows: Number(mappedRows.total_rows) || 0,
    is_clob_only,
    is_eligible,
  };
}

// -----------------------------------------------------------------------------
// Position Details (for debugging)
// -----------------------------------------------------------------------------

export async function getV21PositionDetails(wallet: string): Promise<V21PositionDetail[]> {
  const query = `
    WITH
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
      ordered AS (
        SELECT
          cid, oidx, usdc, tokens, resolution, etime, event_id,
          coalesce(sum(tokens) OVER (
            PARTITION BY cid, oidx
            ORDER BY etime, event_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS pos_before
        FROM dedup
      ),
      clamped AS (
        SELECT
          cid, oidx, resolution, tokens, usdc, pos_before,
          if(tokens < 0, greatest(tokens, -greatest(pos_before, 0)), tokens) AS token_delta_eff,
          if(tokens < 0 AND tokens != 0, usdc * (greatest(tokens, -greatest(pos_before, 0)) / tokens), usdc) AS usdc_delta_eff
        FROM ordered
      ),
      positions AS (
        SELECT
          c.cid AS condition_id,
          c.oidx AS outcome_index,
          sum(c.usdc_delta_eff) AS cash_flow_eff,
          sum(c.token_delta_eff) AS final_tokens_eff,
          any(c.resolution) AS payout_norm,
          count() AS trade_count,
          any(mp.mark_price) AS mark_price
        FROM clamped c
        LEFT JOIN pm_latest_mark_price_v1 mp
          ON c.cid = mp.condition_id AND c.oidx = mp.outcome_index
        GROUP BY c.cid, c.oidx
      )
    SELECT
      condition_id,
      outcome_index,
      cash_flow_eff,
      final_tokens_eff,
      if(payout_norm IS NOT NULL, payout_norm, coalesce(mark_price, 0.5)) AS settlement_price,
      payout_norm IS NOT NULL AS is_resolved,
      round(cash_flow_eff + final_tokens_eff * if(payout_norm IS NOT NULL, payout_norm, coalesce(mark_price, 0.5)), 2) AS position_pnl,
      trade_count
    FROM positions
    ORDER BY abs(position_pnl) DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map(r => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    cash_flow_eff: Number(r.cash_flow_eff),
    final_tokens_eff: Number(r.final_tokens_eff),
    settlement_price: Number(r.settlement_price),
    is_resolved: Boolean(r.is_resolved),
    position_pnl: Number(r.position_pnl),
    trade_count: Number(r.trade_count),
  }));
}

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

function createEmptyResult(wallet: string): V21WalletResult {
  return {
    wallet,
    gain: 0,
    loss: 0,
    net: 0,
    realized_pnl: 0,
    unrealized_pnl: 0,
    positions: 0,
    resolved_positions: 0,
    unresolved_positions: 0,
    markets: 0,
    external_sell_pct: 0,
    mapped_ratio: 0,
    clob_rows: 0,
    is_clob_only: true,
    is_eligible: false,
  };
}
