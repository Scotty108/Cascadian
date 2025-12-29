/**
 * UI Activity PnL Engine V3 + FPMM
 *
 * ============================================================================
 * EXTENDS V3 WITH FPMM (AMM) TRADING DATA
 * ============================================================================
 *
 * This is V3 engine extended to include FPMM (Fixed Product Market Maker) trades.
 * The original V3 only tracks CLOB trades, but many early Polymarket users traded
 * via AMM pools before CLOB was introduced. This extension adds those trades.
 *
 * Data Sources:
 * 1. CLOB trades from pm_trader_events_v2 (deduplicated via GROUP BY event_id)
 * 2. FPMM trades from pm_fpmm_trades (joined with pm_fpmm_pool_map for condition_id)
 * 3. PayoutRedemption events from pm_ctf_events (burns treated as sells at payout_price)
 * 4. Implicit resolution losses: remaining positions in resolved markets → realized at payout
 *
 * Key differences from V3:
 * - Adds getFpmmFillsForWallet() to load AMM trades
 * - Merges FPMM events into the event stream before processing
 * - Uses block_number for FPMM ordering (trade_time is unreliable in that table)
 *
 * Reference: docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md
 */

import { clickhouse } from '../clickhouse/client';
import {
  ActivityEvent,
  OutcomeState,
  ResolutionInfo,
  WalletActivityMetrics,
  WalletActivityMetricsExtended,
  WalletActivityMetricsDebug,
  getRedemptionsForWallet,
  getResolutionsForConditions,
  calculateActivityPnL,
} from './uiActivityEngineV3';

// -----------------------------------------------------------------------------
// FPMM Event Types
// -----------------------------------------------------------------------------

export interface FpmmActivityEvent extends ActivityEvent {
  block_number?: number; // FPMM uses block_number for ordering
}

// -----------------------------------------------------------------------------
// FPMM Data Loading Function
// -----------------------------------------------------------------------------

/**
 * Load FPMM (AMM) fills for a wallet from pm_fpmm_trades.
 *
 * Joins with pm_fpmm_pool_map to get the condition_id for each trade.
 * Uses block_number for ordering since trade_time is unreliable (mostly 1970-01-01).
 *
 * Data Quality Filters:
 * - token_amount > 0 and usdc_amount > 0 (valid trades only)
 * - price >= 0.01 and <= 2.0 (reasonable price range)
 *
 * IMPORTANT: Sub-penny trades (price < $0.01) are excluded because they cause
 * astronomical PnL values when resolved. These are likely edge cases from
 * AMM pool mechanics (liquidity adds, dust trades, etc).
 *
 * @param wallet - The wallet address (case-insensitive)
 * @returns Array of ActivityEvent objects for FPMM buys and sells
 */
export async function getFpmmFillsForWallet(wallet: string): Promise<FpmmActivityEvent[]> {
  const query = `
    SELECT
      p.condition_id,
      t.outcome_index,
      t.block_number,
      -- Use block_number as a proxy timestamp since trade_time is unreliable
      -- We'll convert to a synthetic timestamp for ordering
      toString(toDateTime(t.block_number * 2 + 1500000000)) as event_time,
      t.side,
      t.token_amount as qty_tokens,
      t.usdc_amount as usdc_notional,
      CASE WHEN t.token_amount > 0
        THEN t.usdc_amount / t.token_amount
        ELSE 0
      END as price
    FROM pm_fpmm_trades t
    INNER JOIN pm_fpmm_pool_map p ON lower(t.fpmm_pool_address) = lower(p.fpmm_pool_address)
    WHERE lower(t.trader_wallet) = lower('${wallet}')
      AND t.is_deleted = 0
      AND p.condition_id IS NOT NULL
      AND p.condition_id != ''
      AND t.token_amount > 0
      AND t.usdc_amount > 0
      AND t.usdc_amount / t.token_amount >= 0.01  -- Min price filter (exclude sub-penny)
      AND t.usdc_amount / t.token_amount <= 2     -- Max price filter
    ORDER BY t.block_number ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    event_time: r.event_time,
    event_type: r.side === 'buy' ? ('CLOB_BUY' as const) : ('CLOB_SELL' as const),
    qty_tokens: Number(r.qty_tokens),
    usdc_notional: Number(r.usdc_notional),
    price: Number(r.price),
    block_number: Number(r.block_number),
  }));
}

/**
 * Load CLOB fills for a wallet from pm_trader_events_v2.
 * This is a copy of getClobFillsForWallet from V3 but returns FpmmActivityEvent
 * with block_number for consistent ordering with FPMM events.
 */
export async function getClobFillsWithBlockForWallet(
  wallet: string
): Promise<FpmmActivityEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time as event_time,
      fills.block_number,
      fills.side,
      fills.qty_tokens,
      fills.usdc_notional,
      fills.price
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(block_number) as block_number,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    event_time: r.event_time,
    event_type: r.side === 'buy' ? ('CLOB_BUY' as const) : ('CLOB_SELL' as const),
    qty_tokens: Number(r.qty_tokens),
    usdc_notional: Number(r.usdc_notional),
    price: Number(r.price),
    block_number: r.block_number ? Number(r.block_number) : undefined,
  }));
}

// -----------------------------------------------------------------------------
// Payout Normalization (fixes inconsistent payout_numerators formats)
// -----------------------------------------------------------------------------

/**
 * Normalize payout numerators to dollar values (0-1 range).
 *
 * The pm_condition_resolutions table has inconsistent payout formats:
 * - [1, 0] - raw dollar values (most common for older data)
 * - [1000000, 0] - scaled by 1e6 (USDC microunits)
 * - [1000000000000000000, 0] - scaled by 1e18 (Wei)
 *
 * This function detects the scale and normalizes to dollar values.
 *
 * @param payouts - Raw payout array from pm_condition_resolutions
 * @returns Normalized payout array where values are in 0-1 dollar range
 */
function normalizePayouts(payouts: number[]): number[] {
  if (!payouts || payouts.length === 0) return [];

  const maxPayout = Math.max(...payouts);

  // Already normalized (max is 1 or less)
  if (maxPayout <= 1.01) {
    return payouts;
  }

  // Detect scale factor
  // For binary markets: sum should be ~$1 or ~1e6 or ~1e18
  const sum = payouts.reduce((a, b) => a + b, 0);

  let scaleFactor: number;

  if (sum > 5e17) {
    // 1e18 scale (Wei)
    scaleFactor = 1e18;
  } else if (sum > 5e5) {
    // 1e6 scale (USDC microunits)
    scaleFactor = 1e6;
  } else if (sum > 5e2) {
    // 1e3 scale (unlikely but handle it)
    scaleFactor = sum; // Normalize so sum = 1
  } else {
    // Small values but > 1, normalize by max
    scaleFactor = maxPayout;
  }

  return payouts.map((p) => p / scaleFactor);
}

/**
 * Get resolutions for conditions with normalized payouts.
 *
 * This is a wrapper around V3's getResolutionsForConditions that adds
 * payout normalization to handle inconsistent data formats.
 *
 * @param conditionIds - Array of condition IDs to look up
 * @returns Map of lowercase condition_id → ResolutionInfo with normalized payouts
 */
async function getResolutionsForConditionsNormalized(
  conditionIds: string[]
): Promise<Map<string, ResolutionInfo>> {
  // Get raw resolutions from V3
  const rawResolutions = await getResolutionsForConditions(conditionIds);

  // Normalize payouts
  const normalizedResolutions = new Map<string, ResolutionInfo>();
  for (const [key, resolution] of rawResolutions) {
    normalizedResolutions.set(key, {
      ...resolution,
      payout_numerators: normalizePayouts(resolution.payout_numerators),
    });
  }

  return normalizedResolutions;
}

// -----------------------------------------------------------------------------
// Main Entry Points (V3 + FPMM)
// -----------------------------------------------------------------------------

/**
 * Compute V3+FPMM Activity PnL for a single wallet.
 *
 * This extends V3 by also loading FPMM (AMM) trades and merging them
 * into the event stream. This captures trading activity from before
 * the CLOB was introduced.
 *
 * @param wallet - The wallet address to compute PnL for
 * @returns WalletActivityMetrics with pnl_activity_total, etc.
 */
export async function computeWalletActivityPnlV3WithFPMM(
  wallet: string
): Promise<WalletActivityMetrics> {
  // Load CLOB fills, FPMM fills, and redemptions
  const clobFills = await getClobFillsWithBlockForWallet(wallet);
  const fpmmFills = await getFpmmFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);

  // Merge all events
  const allEvents: ActivityEvent[] = [...clobFills, ...fpmmFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions (with normalized payouts)
  const resolutions = await getResolutionsForConditionsNormalized(conditionIds);

  // Run the cost-basis algorithm (same as V3)
  const metrics = calculateActivityPnL(allEvents, resolutions);

  return {
    wallet,
    pnl_activity_total: metrics.pnl_activity_total,
    gain_activity: metrics.gain_activity,
    loss_activity: metrics.loss_activity,
    volume_traded: metrics.volume_traded,
    fills_count: metrics.fills_count,
    redemptions_count: metrics.redemptions_count,
  };
}

/**
 * Compute V3+FPMM Activity PnL with extended metrics.
 */
export async function computeWalletActivityPnlV3WithFPMMExtended(
  wallet: string
): Promise<WalletActivityMetricsExtended & { fpmm_fills_count: number }> {
  // Load CLOB fills, FPMM fills, and redemptions
  const clobFills = await getClobFillsWithBlockForWallet(wallet);
  const fpmmFills = await getFpmmFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);

  // Merge all events
  const allEvents: ActivityEvent[] = [...clobFills, ...fpmmFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions (with normalized payouts)
  const resolutions = await getResolutionsForConditionsNormalized(conditionIds);

  // Run the cost-basis algorithm
  const metrics = calculateActivityPnL(allEvents, resolutions);

  return {
    wallet,
    pnl_activity_total: metrics.pnl_activity_total,
    gain_activity: metrics.gain_activity,
    loss_activity: metrics.loss_activity,
    volume_traded: metrics.volume_traded,
    fills_count: metrics.fills_count,
    redemptions_count: metrics.redemptions_count,
    outcomes_traded: metrics.outcomes_traded,
    total_events: metrics.total_events,
    resolution_loss_events: metrics.resolution_loss_events,
    // Additional metric for FPMM
    fpmm_fills_count: fpmmFills.length,
  };
}

/**
 * Compute V3+FPMM Activity PnL with full debug decomposition.
 */
export async function computeWalletActivityPnlV3WithFPMMDebug(
  wallet: string
): Promise<WalletActivityMetricsDebug & { fpmm_fills_count: number; clob_fills_count: number }> {
  // Load CLOB fills, FPMM fills, and redemptions
  const clobFills = await getClobFillsWithBlockForWallet(wallet);
  const fpmmFills = await getFpmmFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);

  // Merge all events
  const allEvents: ActivityEvent[] = [...clobFills, ...fpmmFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions (with normalized payouts)
  const resolutions = await getResolutionsForConditionsNormalized(conditionIds);

  // Run the cost-basis algorithm
  const metrics = calculateActivityPnL(allEvents, resolutions);

  return {
    wallet,
    pnl_activity_total: metrics.pnl_activity_total,
    gain_activity: metrics.gain_activity,
    loss_activity: metrics.loss_activity,
    volume_traded: metrics.volume_traded,
    fills_count: metrics.fills_count,
    redemptions_count: metrics.redemptions_count,
    outcomes_traded: metrics.outcomes_traded,
    total_events: metrics.total_events,
    resolution_loss_events: metrics.resolution_loss_events,
    // Debug fields
    pnl_from_clob: metrics.pnl_from_clob,
    pnl_from_redemptions: metrics.pnl_from_redemptions,
    pnl_from_resolution_losses: metrics.pnl_from_resolution_losses,
    clob_buy_count: metrics.clob_buy_count,
    clob_sell_count: metrics.clob_sell_count,
    volume_buys: metrics.volume_buys,
    volume_sells: metrics.volume_sells,
    conditions_with_unredeemed_winners: metrics.conditions_with_unredeemed_winners,
    conditions_with_unredeemed_losers: metrics.conditions_with_unredeemed_losers,
    // Additional FPMM metrics
    fpmm_fills_count: fpmmFills.length,
    clob_fills_count: clobFills.length,
  };
}
