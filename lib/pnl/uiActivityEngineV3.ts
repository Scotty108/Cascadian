/**
 * UI Activity PnL Engine V3
 *
 * ============================================================================
 * FROZEN ALGORITHM - DO NOT MODIFY WITHOUT EXPLICIT USER APPROVAL
 * Session 14 Final Version - 2025-11-28
 * ============================================================================
 *
 * A reusable cost-basis realized PnL engine that matches the Polymarket wallet UI's
 * "Profit/Loss" metric. This module extracts the core V3 algorithm from the simulator
 * for use in materialization scripts and API endpoints.
 *
 * Algorithm: Average Cost Basis + Redemptions + Implicit Resolution Losses
 *
 * Data Sources:
 * 1. CLOB trades from pm_trader_events_v3 (deduplicated via GROUP BY event_id)
 * 2. PayoutRedemption events from pm_ctf_events (burns treated as sells at payout_price)
 * 3. Implicit resolution losses: remaining positions in resolved markets → realized at payout
 *
 * WHY V3 IS FINAL:
 * - V1 (CLOB-only): Missing redemption PnL
 * - V2 (+Redemptions): Missing resolution losses
 * - V3 (+Both winners and losers): Best overall fit (0% error for W2)
 * - V4 (Asymmetric - losers only): Made errors WORSE (212-655% for W1, W4)
 *
 * TRUST HIERARCHY:
 * - Tier 1 (Canonical): fills_count, redemptions_count, outcomes_traded
 * - Tier 2 (Approximate): pnl_activity_total, volume_traded
 * - Tier 3 (Unreliable): gain_activity, loss_activity
 *
 * Reference: docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md
 *            docs/systems/database/PNL_V10_UI_ACTIVITY_PNL_SPEC.md
 *
 * KNOWN ISSUES (from Session 14 analysis):
 * - Volume is counted only on CLOB trades, UI might count differently (-6% to -47%)
 * - Gain/Loss breakdown doesn't match UI (we aggregate per outcome, UI per trade)
 * - W3 outlier: UI doesn't auto-realize gains on unredeemed winning positions
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ActivityEvent {
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type: 'CLOB_BUY' | 'CLOB_SELL' | 'REDEMPTION' | 'RESOLUTION_LOSS';
  qty_tokens: number;
  usdc_notional: number;
  price: number;
}

export interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
  // Debug: PnL by source
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution: number;
}

export interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
  resolved_at: string;
}

/**
 * Output metrics from the V3 Activity PnL engine.
 * This is the core interface used for materialization and API responses.
 *
 * TRUST HIERARCHY:
 * - Tier 1 (Canonical): fills_count, redemptions_count
 * - Tier 2 (Approximate, 0-26% error): pnl_activity_total, volume_traded
 * - Tier 3 (Unreliable, DO NOT USE FOR DISPLAY): gain_activity, loss_activity
 */
export interface WalletActivityMetrics {
  wallet: string;

  /** @trust Tier 2 (Approximate) - Error: 0% for full redeemers, 7-26% for partial */
  pnl_activity_total: number;

  /** @trust Tier 3 (UNRELIABLE) - Error: 23-89% vs UI. Do not use for display. */
  gain_activity: number;

  /** @trust Tier 3 (UNRELIABLE) - Error: 80-400% vs UI. Do not use for display. */
  loss_activity: number;

  /** @trust Tier 2 (Approximate) - Error: -6% to -47% vs UI. Undercounts redemptions. */
  volume_traded: number;

  /** @trust Tier 1 (Canonical) - Deduplicated CLOB event count */
  fills_count: number;

  /** @trust Tier 1 (Canonical) - PayoutRedemption event count */
  redemptions_count: number;
}

/**
 * Extended metrics with additional debugging info.
 * Used for detailed analysis and benchmarking.
 */
export interface WalletActivityMetricsExtended extends WalletActivityMetrics {
  /** @trust Tier 1 (Canonical) - Unique (condition_id, outcome_index) pairs traded */
  outcomes_traded: number;

  /** @trust Tier 1 (Canonical) - Total events processed */
  total_events: number;

  /** @trust Tier 1 (Canonical) - Positions auto-realized at resolution */
  resolution_loss_events: number;
}

/**
 * Debug metrics showing PnL breakdown by source.
 * Used for investigating discrepancies with UI.
 */
export interface WalletActivityMetricsDebug extends WalletActivityMetricsExtended {
  // PnL decomposition
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution_losses: number;

  // Event counts by type
  clob_buy_count: number;
  clob_sell_count: number;

  // Volume breakdown
  volume_buys: number;
  volume_sells: number;

  // Position stats
  conditions_with_unredeemed_winners: number;
  conditions_with_unredeemed_losers: number;
}

// -----------------------------------------------------------------------------
// Data Loading Functions
// -----------------------------------------------------------------------------

/**
 * Load CLOB fills for a wallet from pm_trader_events_v3.
 *
 * Uses the standard deduplication pattern (GROUP BY event_id) to handle
 * duplicate rows in the table.
 *
 * @param wallet - The wallet address (case-insensitive)
 * @returns Array of ActivityEvent objects for CLOB buys and sells
 */
export async function getClobFillsForWallet(wallet: string): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time as event_time,
      fills.side,
      fills.qty_tokens,
      fills.usdc_notional,
      fills.price
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
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
  }));
}

/**
 * Load PayoutRedemption events for a wallet from pm_ctf_events.
 *
 * Each redemption is converted to a "sell at payout_price" event.
 * We calculate tokens_burned = payout_usdc / payout_price for each winning outcome.
 *
 * @param wallet - The wallet address (case-insensitive)
 * @returns Array of ActivityEvent objects for redemptions
 */
export async function getRedemptionsForWallet(wallet: string): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      e.condition_id,
      e.amount_or_payout,
      e.event_timestamp,
      r.payout_numerators
    FROM pm_ctf_events e
    LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
    WHERE lower(e.user_address) = lower('${wallet}')
      AND e.event_type = 'PayoutRedemption'
      AND e.is_deleted = 0
    ORDER BY e.event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const events: ActivityEvent[] = [];

  for (const r of rows) {
    const payout_usdc = Number(r.amount_or_payout) / 1e6;
    const payout_numerators = r.payout_numerators ? JSON.parse(r.payout_numerators) : null;

    if (!payout_numerators || payout_usdc <= 0) continue;

    for (let i = 0; i < payout_numerators.length; i++) {
      const payout_price = payout_numerators[i];
      if (payout_price > 0) {
        const tokens_burned = payout_usdc / payout_price;
        events.push({
          condition_id: r.condition_id,
          outcome_index: i,
          event_time: r.event_timestamp,
          event_type: 'REDEMPTION',
          qty_tokens: tokens_burned,
          usdc_notional: payout_usdc,
          price: payout_price,
        });
      }
    }
  }

  return events;
}

/**
 * Load resolution info for a set of condition IDs.
 *
 * @param conditionIds - Array of condition IDs to look up
 * @returns Map of lowercase condition_id → ResolutionInfo
 */
export async function getResolutionsForConditions(
  conditionIds: string[]
): Promise<Map<string, ResolutionInfo>> {
  if (conditionIds.length === 0) return new Map();

  const conditionList = conditionIds.map((c) => `'${c}'`).join(',');
  const query = `
    SELECT
      condition_id,
      payout_numerators,
      resolved_at
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${conditionList.toLowerCase()})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const resolutions = new Map<string, ResolutionInfo>();
  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutions.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: payouts,
      resolved_at: r.resolved_at,
    });
  }
  return resolutions;
}

// -----------------------------------------------------------------------------
// Core Algorithm
// -----------------------------------------------------------------------------

interface CalculationResult {
  pnl_activity_total: number;
  gain_activity: number;
  loss_activity: number;
  volume_traded: number;
  fills_count: number;
  redemptions_count: number;
  outcomes_traded: number;
  total_events: number;
  resolution_loss_events: number;
  // Debug fields
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution_losses: number;
  clob_buy_count: number;
  clob_sell_count: number;
  volume_buys: number;
  volume_sells: number;
  conditions_with_unredeemed_winners: number;
  conditions_with_unredeemed_losers: number;
}

/**
 * Core cost-basis PnL calculation engine.
 *
 * Processes events in time order using average cost basis accounting:
 * - BUY: Add to position at cost
 * - SELL/REDEMPTION: Realize PnL using (price - avg_cost) × qty
 * - POST-PROCESS: Realize implicit losses for remaining positions in resolved markets
 *
 * @param events - Array of all activity events (CLOB + redemptions)
 * @param resolutions - Map of condition_id → resolution info
 * @returns Full calculation results including debug decomposition
 */
export function calculateActivityPnL(
  events: ActivityEvent[],
  resolutions: Map<string, ResolutionInfo>
): CalculationResult {
  // Sort all events by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  // State per outcome (condition_id + outcome_index)
  const outcomeStates = new Map<string, OutcomeState>();

  const getKey = (conditionId: string, outcomeIndex: number): string =>
    `${conditionId}_${outcomeIndex}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let fills_count = 0;
  let redemptions_count = 0;
  let clob_buy_count = 0;
  let clob_sell_count = 0;

  // Debug: PnL by source (global)
  let pnl_from_clob = 0;
  let pnl_from_redemptions = 0;

  // Process events in time order
  for (const event of events) {
    const key = getKey(event.condition_id, event.outcome_index);

    if (!outcomeStates.has(key)) {
      outcomeStates.set(key, {
        position_qty: 0,
        position_cost: 0,
        realized_pnl: 0,
        pnl_from_clob: 0,
        pnl_from_redemptions: 0,
        pnl_from_resolution: 0,
      });
    }

    const state = outcomeStates.get(key)!;

    if (event.event_type === 'CLOB_BUY') {
      clob_buy_count++;
      fills_count++;
      volume_buys += event.usdc_notional;
      volume_traded += event.usdc_notional;
      state.position_cost += event.usdc_notional;
      state.position_qty += event.qty_tokens;
    } else if (event.event_type === 'CLOB_SELL') {
      clob_sell_count++;
      fills_count++;
      volume_sells += event.usdc_notional;
      volume_traded += event.usdc_notional;

      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
        const pnl_now = (event.price - avg_cost) * qty_to_sell;
        state.realized_pnl += pnl_now;
        state.pnl_from_clob += pnl_now;
        pnl_from_clob += pnl_now;
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;
      }
    } else if (event.event_type === 'REDEMPTION') {
      redemptions_count++;

      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
        const pnl_now = (event.price - avg_cost) * qty_to_sell;
        state.realized_pnl += pnl_now;
        state.pnl_from_redemptions += pnl_now;
        pnl_from_redemptions += pnl_now;
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;
      }
    }
  }

  // PHASE 2: Apply implicit resolution losses
  // For any remaining positions in RESOLVED markets, realize the loss/gain at payout price
  let resolution_loss_events = 0;
  let pnl_from_resolution_losses = 0;
  let conditions_with_unredeemed_winners = 0;
  let conditions_with_unredeemed_losers = 0;

  // Track which conditions have remaining positions
  const conditionsWithPositions = new Map<string, { winners: number; losers: number }>();

  for (const [key, state] of outcomeStates.entries()) {
    if (state.position_qty <= 0.01) continue; // No meaningful position

    const [conditionId, outcomeIndexStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr, 10);
    const resolution = resolutions.get(conditionId.toLowerCase());

    if (!resolution || !resolution.payout_numerators) continue; // Not resolved

    const payout_price = resolution.payout_numerators[outcomeIndex] || 0;

    // Track unredeemed winners vs losers
    if (!conditionsWithPositions.has(conditionId)) {
      conditionsWithPositions.set(conditionId, { winners: 0, losers: 0 });
    }
    const stats = conditionsWithPositions.get(conditionId)!;
    if (payout_price > 0) {
      stats.winners++;
    } else {
      stats.losers++;
    }

    // "Sell" remaining position at payout price
    const avg_cost = state.position_cost / state.position_qty;
    const pnl_from_resolution = (payout_price - avg_cost) * state.position_qty;

    state.realized_pnl += pnl_from_resolution;
    state.pnl_from_resolution += pnl_from_resolution;
    pnl_from_resolution_losses += pnl_from_resolution;
    state.position_qty = 0;
    state.position_cost = 0;
    resolution_loss_events++;
  }

  // Count conditions with unredeemed positions
  for (const stats of conditionsWithPositions.values()) {
    if (stats.winners > 0) conditions_with_unredeemed_winners++;
    if (stats.losers > 0) conditions_with_unredeemed_losers++;
  }

  // Aggregate across all outcomes
  let pnl_activity_total = 0;
  let gain_activity = 0;
  let loss_activity = 0;

  for (const state of outcomeStates.values()) {
    pnl_activity_total += state.realized_pnl;
    if (state.realized_pnl > 0) {
      gain_activity += state.realized_pnl;
    } else {
      loss_activity += state.realized_pnl;
    }
  }

  return {
    pnl_activity_total,
    gain_activity,
    loss_activity,
    volume_traded,
    fills_count,
    redemptions_count,
    outcomes_traded: outcomeStates.size,
    total_events: events.length,
    resolution_loss_events,
    // Debug fields
    pnl_from_clob,
    pnl_from_redemptions,
    pnl_from_resolution_losses,
    clob_buy_count,
    clob_sell_count,
    volume_buys,
    volume_sells,
    conditions_with_unredeemed_winners,
    conditions_with_unredeemed_losers,
  };
}

// -----------------------------------------------------------------------------
// Main Entry Points
// -----------------------------------------------------------------------------

/**
 * Compute V3 Activity PnL for a single wallet.
 *
 * This is the main entry point for the V3 engine. It:
 * 1. Loads CLOB fills for the wallet
 * 2. Loads PayoutRedemption events for the wallet
 * 3. Merges events and looks up resolutions
 * 4. Runs the cost-basis algorithm
 * 5. Returns the wallet metrics
 *
 * @param wallet - The wallet address to compute PnL for
 * @returns WalletActivityMetrics with pnl_activity_total, gain_activity, loss_activity, etc.
 */
export async function computeWalletActivityPnlV3(wallet: string): Promise<WalletActivityMetrics> {
  // Load CLOB fills and redemptions
  const clobFills = await getClobFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);
  const allEvents = [...clobFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions
  const resolutions = await getResolutionsForConditions(conditionIds);

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
  };
}

/**
 * Compute V3 Activity PnL with extended metrics for benchmarking.
 *
 * Same as computeWalletActivityPnlV3 but returns additional event counts.
 *
 * @param wallet - The wallet address to compute PnL for
 * @returns Extended metrics including event counts and resolution losses
 */
export async function computeWalletActivityPnlV3Extended(
  wallet: string
): Promise<WalletActivityMetricsExtended> {
  // Load CLOB fills and redemptions
  const clobFills = await getClobFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);
  const allEvents = [...clobFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions
  const resolutions = await getResolutionsForConditions(conditionIds);

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
  };
}

/**
 * Compute V3 Activity PnL with full debug decomposition.
 *
 * Use this for investigating discrepancies between our calculations and the UI.
 *
 * @param wallet - The wallet address to compute PnL for
 * @returns Full debug metrics including PnL breakdown by source
 */
export async function computeWalletActivityPnlV3Debug(
  wallet: string
): Promise<WalletActivityMetricsDebug> {
  // Load CLOB fills and redemptions
  const clobFills = await getClobFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);
  const allEvents = [...clobFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions
  const resolutions = await getResolutionsForConditions(conditionIds);

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
  };
}
