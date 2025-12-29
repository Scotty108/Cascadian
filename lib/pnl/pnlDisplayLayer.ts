/**
 * ============================================================================
 * CASCADIAN PNL DISPLAY LAYER (Mark-to-Market)
 * ============================================================================
 *
 * This is a DISPLAY LAYER on top of V20, not a replacement.
 *
 * PURPOSE:
 *   For wallets with significant open exposure, using 0.5 as the mark price
 *   for unrealized positions creates large errors vs UI. This layer:
 *   1. Detects "open-heavy" wallets
 *   2. For those wallets, uses last-trade prices instead of 0.5
 *   3. Returns a display PnL that's closer to Polymarket UI
 *
 * V20 REMAINS CANONICAL for:
 *   - Realized PnL calculations
 *   - Regression testing
 *   - Product documentation
 *
 * DISPLAY LAYER IS FOR:
 *   - UI display when wallet has open positions
 *   - Getting closer to Polymarket "All-time" PnL
 *
 * ============================================================================
 */

import { clickhouse } from '../clickhouse/client';
import { calculateV20PnL } from './uiActivityEngineV20';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type PnLMode = 'realized_only' | 'realized_plus_mark';

export interface DisplayPnL {
  wallet: string;
  mode: PnLMode;
  displayed_pnl: number;
  realized_pnl: number;
  unrealized_pnl_05: number;  // original 0.5 estimate
  unrealized_at_mark: number;  // with last-trade prices
  open_notional: number;
  unrealized_share: number;
  positions_open: number;
  positions_resolved: number;
}

// -----------------------------------------------------------------------------
// Open Exposure Stats
// -----------------------------------------------------------------------------

interface OpenExposureStats {
  open_notional: number;
  unrealized_share: number;
  positions_open: number;
  positions_resolved: number;
  realized_pnl: number;
  unrealized_pnl_05: number;
}

async function computeOpenExposureStats(wallet: string): Promise<OpenExposureStats> {
  const query = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        any(payout_norm) AS resolution_price
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      countIf(resolution_price IS NULL) AS positions_open,
      countIf(resolution_price IS NOT NULL) AS positions_resolved,
      sumIf(abs(final_tokens) * 0.5, resolution_price IS NULL) AS open_notional,
      sumIf(cash_flow + final_tokens * resolution_price, resolution_price IS NOT NULL) AS realized_pnl,
      sumIf(cash_flow + final_tokens * 0.5, resolution_price IS NULL) AS unrealized_pnl_05
    FROM positions
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return {
      open_notional: 0,
      unrealized_share: 0,
      positions_open: 0,
      positions_resolved: 0,
      realized_pnl: 0,
      unrealized_pnl_05: 0
    };
  }

  const r = rows[0];
  const realized = Math.abs(Number(r.realized_pnl) || 0);
  const unrealized = Math.abs(Number(r.unrealized_pnl_05) || 0);
  const total = realized + unrealized;

  return {
    open_notional: Number(r.open_notional) || 0,
    unrealized_share: total > 0 ? unrealized / total : 0,
    positions_open: Number(r.positions_open) || 0,
    positions_resolved: Number(r.positions_resolved) || 0,
    realized_pnl: Number(r.realized_pnl) || 0,
    unrealized_pnl_05: Number(r.unrealized_pnl_05) || 0,
  };
}

// -----------------------------------------------------------------------------
// Classification
// -----------------------------------------------------------------------------

function shouldUseMarkToMarket(stats: OpenExposureStats): boolean {
  // Use mark-to-market if:
  // 1. Open notional > $10k AND unrealized share > 30%
  // OR
  // 2. Open notional > $100k (regardless of share)

  if (stats.open_notional > 100_000) return true;
  if (stats.open_notional > 10_000 && stats.unrealized_share > 0.3) return true;

  return false;
}

// -----------------------------------------------------------------------------
// Last Trade Price Fetching
// -----------------------------------------------------------------------------

async function fetchLastTradePrices(
  wallet: string
): Promise<Map<string, number>> {
  // Get last trade price for each unresolved position from market-wide trades
  const query = `
    WITH wallet_open_positions AS (
      SELECT DISTINCT
        condition_id,
        outcome_index
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
      HAVING any(payout_norm) IS NULL
    ),
    market_last_trades AS (
      SELECT
        l.condition_id,
        l.outcome_index,
        argMax(
          abs(l.usdc_delta) / nullIf(abs(l.token_delta), 0),
          l.block_time
        ) AS last_price
      FROM pm_unified_ledger_v7 l
      INNER JOIN wallet_open_positions wp
        ON l.condition_id = wp.condition_id
        AND l.outcome_index = wp.outcome_index
      WHERE l.source_type = 'CLOB'
        AND l.token_delta != 0
        AND l.usdc_delta != 0
      GROUP BY l.condition_id, l.outcome_index
    )
    SELECT
      condition_id,
      outcome_index,
      last_price
    FROM market_last_trades
    WHERE last_price IS NOT NULL
      AND last_price > 0
      AND last_price < 1.5
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const priceMap = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.condition_id}:${row.outcome_index}`;
    let price = Number(row.last_price);
    // Clamp to valid range [0.01, 0.99]
    price = Math.max(0.01, Math.min(0.99, price));
    priceMap.set(key, price);
  }

  return priceMap;
}

// -----------------------------------------------------------------------------
// Mark-to-Market Calculation
// -----------------------------------------------------------------------------

async function calculateWithMarkPrices(
  wallet: string,
  priceMap: Map<string, number>
): Promise<{ realized_pnl: number; unrealized_at_mark: number }> {
  const query = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        any(payout_norm) AS resolution_price
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      condition_id,
      outcome_index,
      cash_flow,
      final_tokens,
      resolution_price
    FROM positions
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const positions = (await result.json()) as any[];

  let realized_pnl = 0;
  let unrealized_at_mark = 0;

  for (const pos of positions) {
    const cashFlow = Number(pos.cash_flow);
    const tokens = Number(pos.final_tokens);
    const resolutionPrice = pos.resolution_price !== null ? Number(pos.resolution_price) : null;

    if (resolutionPrice !== null) {
      // Resolved position - use actual resolution price
      realized_pnl += cashFlow + tokens * resolutionPrice;
    } else {
      // Unresolved - use mark price or fallback to 0.5
      const key = `${pos.condition_id}:${pos.outcome_index}`;
      const markPrice = priceMap.get(key) ?? 0.5;
      unrealized_at_mark += cashFlow + tokens * markPrice;
    }
  }

  return {
    realized_pnl: Math.round(realized_pnl * 100) / 100,
    unrealized_at_mark: Math.round(unrealized_at_mark * 100) / 100,
  };
}

// -----------------------------------------------------------------------------
// Main Display Function
// -----------------------------------------------------------------------------

export async function getWalletPnlDisplay(wallet: string): Promise<DisplayPnL> {
  // Step 1: Compute open exposure stats
  const stats = await computeOpenExposureStats(wallet);

  // Step 2: Decide which mode to use
  const useMarkToMarket = shouldUseMarkToMarket(stats);

  if (!useMarkToMarket) {
    // Use pure V20 realized PnL (no mark-to-market needed)
    return {
      wallet,
      mode: 'realized_only',
      displayed_pnl: Math.round((stats.realized_pnl + stats.unrealized_pnl_05) * 100) / 100,
      realized_pnl: Math.round(stats.realized_pnl * 100) / 100,
      unrealized_pnl_05: Math.round(stats.unrealized_pnl_05 * 100) / 100,
      unrealized_at_mark: Math.round(stats.unrealized_pnl_05 * 100) / 100, // same as 0.5
      open_notional: stats.open_notional,
      unrealized_share: stats.unrealized_share,
      positions_open: stats.positions_open,
      positions_resolved: stats.positions_resolved,
    };
  }

  // Step 3: Fetch last trade prices for open positions
  const priceMap = await fetchLastTradePrices(wallet);

  // Step 4: Calculate with mark-to-market prices
  const mtmResult = await calculateWithMarkPrices(wallet, priceMap);

  return {
    wallet,
    mode: 'realized_plus_mark',
    displayed_pnl: Math.round((mtmResult.realized_pnl + mtmResult.unrealized_at_mark) * 100) / 100,
    realized_pnl: mtmResult.realized_pnl,
    unrealized_pnl_05: Math.round(stats.unrealized_pnl_05 * 100) / 100,
    unrealized_at_mark: mtmResult.unrealized_at_mark,
    open_notional: stats.open_notional,
    unrealized_share: stats.unrealized_share,
    positions_open: stats.positions_open,
    positions_resolved: stats.positions_resolved,
  };
}

// -----------------------------------------------------------------------------
// Quick comparison function for testing
// -----------------------------------------------------------------------------

export async function compareV20vsDisplayLayer(wallet: string): Promise<{
  v20_pnl: number;
  display_pnl: number;
  mode: PnLMode;
  difference: number;
  positions_open: number;
  positions_resolved: number;
  open_notional: number;
}> {
  const v20 = await calculateV20PnL(wallet);
  const display = await getWalletPnlDisplay(wallet);

  return {
    v20_pnl: v20.total_pnl,
    display_pnl: display.displayed_pnl,
    mode: display.mode,
    difference: display.displayed_pnl - v20.total_pnl,
    positions_open: display.positions_open,
    positions_resolved: display.positions_resolved,
    open_notional: display.open_notional,
  };
}
