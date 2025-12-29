/**
 * UI Activity PnL Engine V4
 *
 * ============================================================================
 * FIFO COST BASIS ENGINE - Improvement over V3
 * Session: 2025-11-30
 * ============================================================================
 *
 * A FIFO (First-In-First-Out) cost-basis realized PnL engine that should match
 * Polymarket's wallet UI more closely than V3's average cost method.
 *
 * KEY DIFFERENCE FROM V3:
 * - V3 uses AVERAGE cost basis: All tokens have the same average cost
 * - V4 uses FIFO cost basis: Sells liquidate oldest lots first
 *
 * This matters when you buy at different prices:
 *   Buy 100 @ $0.40 → lot 1
 *   Buy 100 @ $0.60 → lot 2
 *   Sell 100 @ $0.70
 *
 *   V3 (Average): avg = $0.50 → profit = (0.70 - 0.50) * 100 = $20
 *   V4 (FIFO):    sells lot 1 → profit = (0.70 - 0.40) * 100 = $30
 *
 * Algorithm: FIFO Lot-Based + Redemptions + Implicit Resolution Losses
 *
 * Data Sources:
 * 1. CLOB trades from pm_trader_events_v2 (deduplicated via GROUP BY event_id)
 * 2. PayoutRedemption events from pm_ctf_events (burns treated as sells at payout_price)
 * 3. Implicit resolution losses: remaining positions in resolved markets → realized at payout
 *
 * Reference: docs/systems/pnl/V4_ACCURACY_IMPROVEMENT_PLAN.md
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

/**
 * A lot represents tokens acquired at a specific price and time.
 * FIFO means we sell oldest lots first.
 */
export interface Lot {
  qty: number;
  cost_basis: number; // Price per token when acquired
  acquired_at: string; // Timestamp
}

/**
 * FIFO-based outcome state tracking.
 * Instead of a single avg_cost, we track individual lots.
 */
export interface OutcomeStateFIFO {
  lots: Lot[];
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
 * Output metrics from the V4 Activity PnL engine.
 */
export interface WalletActivityMetrics {
  wallet: string;
  pnl_activity_total: number;
  gain_activity: number;
  loss_activity: number;
  volume_traded: number;
  fills_count: number;
  redemptions_count: number;
}

/**
 * Extended metrics with additional debugging info.
 */
export interface WalletActivityMetricsExtended extends WalletActivityMetrics {
  outcomes_traded: number;
  total_events: number;
  resolution_loss_events: number;
}

/**
 * Debug metrics showing PnL breakdown by source.
 */
export interface WalletActivityMetricsDebug extends WalletActivityMetricsExtended {
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution_losses: number;
  clob_buy_count: number;
  clob_sell_count: number;
  volume_buys: number;
  volume_sells: number;
  conditions_with_unredeemed_winners: number;
  conditions_with_unredeemed_losers: number;
  // V4-specific: lot statistics
  total_lots_created: number;
  total_lots_consumed: number;
}

// -----------------------------------------------------------------------------
// Data Loading Functions (reused from V3)
// -----------------------------------------------------------------------------

/**
 * Load CLOB fills for a wallet from pm_trader_events_v2.
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
  }));
}

/**
 * Load PayoutRedemption events for a wallet from pm_ctf_events.
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
// FIFO Helper Functions
// -----------------------------------------------------------------------------

/**
 * Get total quantity across all lots.
 */
function getTotalQty(lots: Lot[]): number {
  return lots.reduce((sum, lot) => sum + lot.qty, 0);
}

/**
 * Get total cost across all lots.
 */
function getTotalCost(lots: Lot[]): number {
  return lots.reduce((sum, lot) => sum + lot.qty * lot.cost_basis, 0);
}

/**
 * Sell tokens using FIFO: consume oldest lots first.
 * Returns the realized PnL from this sale.
 */
function sellFIFO(lots: Lot[], qtyToSell: number, sellPrice: number): number {
  let remainingQty = qtyToSell;
  let realizedPnl = 0;

  while (remainingQty > 0 && lots.length > 0) {
    const oldestLot = lots[0];

    if (oldestLot.qty <= remainingQty) {
      // Fully consume this lot
      const pnl = oldestLot.qty * (sellPrice - oldestLot.cost_basis);
      realizedPnl += pnl;
      remainingQty -= oldestLot.qty;
      lots.shift(); // Remove exhausted lot
    } else {
      // Partially consume this lot
      const pnl = remainingQty * (sellPrice - oldestLot.cost_basis);
      realizedPnl += pnl;
      oldestLot.qty -= remainingQty;
      remainingQty = 0;
    }
  }

  return realizedPnl;
}

/**
 * Liquidate all remaining lots at resolution price.
 * Returns the realized PnL from resolution.
 */
function liquidateAllAtResolution(lots: Lot[], resolutionPrice: number): number {
  let realizedPnl = 0;

  for (const lot of lots) {
    realizedPnl += lot.qty * (resolutionPrice - lot.cost_basis);
  }

  // Clear all lots
  lots.length = 0;

  return realizedPnl;
}

// -----------------------------------------------------------------------------
// Core FIFO Algorithm
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
  // V4-specific
  total_lots_created: number;
  total_lots_consumed: number;
}

/**
 * Core FIFO cost-basis PnL calculation engine.
 *
 * Processes events in time order using FIFO lot tracking:
 * - BUY: Create a new lot with the purchase price
 * - SELL/REDEMPTION: Consume oldest lots first (FIFO)
 * - POST-PROCESS: Liquidate remaining positions at resolution price
 */
export function calculateActivityPnLFIFO(
  events: ActivityEvent[],
  resolutions: Map<string, ResolutionInfo>
): CalculationResult {
  // Sort all events by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  // State per outcome (condition_id + outcome_index)
  const outcomeStates = new Map<string, OutcomeStateFIFO>();

  const getKey = (conditionId: string, outcomeIndex: number): string =>
    `${conditionId}_${outcomeIndex}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let fills_count = 0;
  let redemptions_count = 0;
  let clob_buy_count = 0;
  let clob_sell_count = 0;
  let total_lots_created = 0;
  let total_lots_consumed = 0;

  // Debug: PnL by source (global)
  let pnl_from_clob = 0;
  let pnl_from_redemptions = 0;

  // Process events in time order
  for (const event of events) {
    const key = getKey(event.condition_id, event.outcome_index);

    if (!outcomeStates.has(key)) {
      outcomeStates.set(key, {
        lots: [],
        realized_pnl: 0,
        pnl_from_clob: 0,
        pnl_from_redemptions: 0,
        pnl_from_resolution: 0,
      });
    }

    const state = outcomeStates.get(key)!;
    const initialLotCount = state.lots.length;

    if (event.event_type === 'CLOB_BUY') {
      clob_buy_count++;
      fills_count++;
      volume_buys += event.usdc_notional;
      volume_traded += event.usdc_notional;

      // Create a new lot for this purchase
      state.lots.push({
        qty: event.qty_tokens,
        cost_basis: event.price,
        acquired_at: event.event_time,
      });
      total_lots_created++;
    } else if (event.event_type === 'CLOB_SELL') {
      clob_sell_count++;
      fills_count++;
      volume_sells += event.usdc_notional;
      volume_traded += event.usdc_notional;

      // FIFO sell: consume oldest lots first
      const totalQty = getTotalQty(state.lots);
      if (totalQty > 0) {
        const qtyToSell = Math.min(event.qty_tokens, totalQty);
        const pnl_now = sellFIFO(state.lots, qtyToSell, event.price);
        state.realized_pnl += pnl_now;
        state.pnl_from_clob += pnl_now;
        pnl_from_clob += pnl_now;
      }
    } else if (event.event_type === 'REDEMPTION') {
      redemptions_count++;

      // FIFO redemption: consume oldest lots first
      const totalQty = getTotalQty(state.lots);
      if (totalQty > 0) {
        const qtyToSell = Math.min(event.qty_tokens, totalQty);
        const pnl_now = sellFIFO(state.lots, qtyToSell, event.price);
        state.realized_pnl += pnl_now;
        state.pnl_from_redemptions += pnl_now;
        pnl_from_redemptions += pnl_now;
      }
    }

    // Count lots consumed
    total_lots_consumed += initialLotCount - state.lots.length;
  }

  // PHASE 2: Apply implicit resolution losses
  let resolution_loss_events = 0;
  let pnl_from_resolution_losses = 0;
  let conditions_with_unredeemed_winners = 0;
  let conditions_with_unredeemed_losers = 0;

  // Track which conditions have remaining positions
  const conditionsWithPositions = new Map<string, { winners: number; losers: number }>();

  for (const [key, state] of outcomeStates.entries()) {
    const totalQty = getTotalQty(state.lots);
    if (totalQty <= 0.01) continue; // No meaningful position

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

    // Liquidate all remaining lots at resolution price
    const pnl_from_resolution = liquidateAllAtResolution(state.lots, payout_price);

    state.realized_pnl += pnl_from_resolution;
    state.pnl_from_resolution += pnl_from_resolution;
    pnl_from_resolution_losses += pnl_from_resolution;
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
    total_lots_created,
    total_lots_consumed,
  };
}

// -----------------------------------------------------------------------------
// Main Entry Points
// -----------------------------------------------------------------------------

/**
 * Compute V4 Activity PnL for a single wallet using FIFO cost basis.
 */
export async function computeWalletActivityPnlV4(wallet: string): Promise<WalletActivityMetrics> {
  // Load CLOB fills and redemptions
  const clobFills = await getClobFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);
  const allEvents = [...clobFills, ...redemptions];

  // Get all unique condition IDs
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

  // Get resolutions for these conditions
  const resolutions = await getResolutionsForConditions(conditionIds);

  // Run the FIFO cost-basis algorithm
  const metrics = calculateActivityPnLFIFO(allEvents, resolutions);

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
 * Compute V4 Activity PnL with extended metrics.
 */
export async function computeWalletActivityPnlV4Extended(
  wallet: string
): Promise<WalletActivityMetricsExtended> {
  const clobFills = await getClobFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);
  const allEvents = [...clobFills, ...redemptions];
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];
  const resolutions = await getResolutionsForConditions(conditionIds);
  const metrics = calculateActivityPnLFIFO(allEvents, resolutions);

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
 * Compute V4 Activity PnL with full debug decomposition.
 */
export async function computeWalletActivityPnlV4Debug(
  wallet: string
): Promise<WalletActivityMetricsDebug> {
  const clobFills = await getClobFillsForWallet(wallet);
  const redemptions = await getRedemptionsForWallet(wallet);
  const allEvents = [...clobFills, ...redemptions];
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];
  const resolutions = await getResolutionsForConditions(conditionIds);
  const metrics = calculateActivityPnLFIFO(allEvents, resolutions);

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
    pnl_from_clob: metrics.pnl_from_clob,
    pnl_from_redemptions: metrics.pnl_from_redemptions,
    pnl_from_resolution_losses: metrics.pnl_from_resolution_losses,
    clob_buy_count: metrics.clob_buy_count,
    clob_sell_count: metrics.clob_sell_count,
    volume_buys: metrics.volume_buys,
    volume_sells: metrics.volume_sells,
    conditions_with_unredeemed_winners: metrics.conditions_with_unredeemed_winners,
    conditions_with_unredeemed_losers: metrics.conditions_with_unredeemed_losers,
    total_lots_created: metrics.total_lots_created,
    total_lots_consumed: metrics.total_lots_consumed,
  };
}
