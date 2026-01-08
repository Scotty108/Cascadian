/**
 * UI Activity PnL Engine V5
 *
 * ============================================================================
 * V5: V3 + Splits/Merges + ERC1155 Transfers
 * ============================================================================
 *
 * Improvements over V3:
 * 1. PositionSplit events - Adds positions at $0.50 cost basis (Polymarket standard)
 * 2. PositionsMerge events - Removes equal amounts from both sides (neutral PnL)
 * 3. ERC1155 transfers - Adds positions when tokens received from other wallets
 *
 * Data Sources:
 * 1. CLOB trades from pm_trader_events_v3 (same as V3)
 * 2. PayoutRedemption events from pm_ctf_events (same as V3)
 * 3. PositionSplit events from pm_ctf_events (NEW)
 * 4. PositionsMerge events from pm_ctf_events (NEW)
 * 5. ERC1155 incoming transfers from pm_erc1155_transfers (NEW)
 * 6. Implicit resolution losses (same as V3)
 *
 * Key insight from Polymarket pnl-subgraph:
 * - Splits/Merges use FIFTY_CENTS (0.50) as the cost basis
 * - Each outcome gets qty tokens at $0.50 per token
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types (Extended from V3)
// -----------------------------------------------------------------------------

export interface ActivityEvent {
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type:
    | 'CLOB_BUY'
    | 'CLOB_SELL'
    | 'REDEMPTION'
    | 'RESOLUTION_LOSS'
    | 'SPLIT'
    | 'MERGE'
    | 'TRANSFER_IN';
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

export interface WalletActivityMetricsV5 {
  wallet: string;
  pnl_activity_total: number;
  gain_activity: number;
  loss_activity: number;
  volume_traded: number;
  fills_count: number;
  redemptions_count: number;
  // V5 additions
  splits_count: number;
  merges_count: number;
  transfers_in_count: number;
}

export interface WalletActivityMetricsV5Debug extends WalletActivityMetricsV5 {
  outcomes_traded: number;
  total_events: number;
  resolution_loss_events: number;
  // PnL decomposition
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution_losses: number;
  pnl_from_splits: number;
  pnl_from_transfers: number;
  // Event counts
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
// Constants
// -----------------------------------------------------------------------------

const FIFTY_CENTS = 0.5; // Standard cost basis for splits (from Polymarket)
const TRANSFER_COST_BASIS = 0.5; // Use $0.50 for transferred tokens too (neutral assumption)

// Known Polymarket contracts to exclude from "new acquisition" transfers
// These transfers are already counted in CLOB trades
const POLYMARKET_EXCHANGE = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const POLYMARKET_CTF = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const POLYMARKET_NEG_RISK_ADAPTER = '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296';
const POLYMARKET_NEG_RISK_CTF = '0xc5d563a36ae78145c45a6b4fc186c6e5f1d2c8c7';
const POLYMARKET_NEG_RISK_CTF_2 = '0xc5d563a36ae78145c4'; // Partial match for other NegRisk

// Addresses to exclude from transfer acquisition
const EXCLUDED_TRANSFER_SOURCES = [
  POLYMARKET_EXCHANGE.toLowerCase(),
  POLYMARKET_CTF.toLowerCase(),
  POLYMARKET_NEG_RISK_ADAPTER.toLowerCase(),
  POLYMARKET_NEG_RISK_CTF.toLowerCase(),
  '0x0000000000000000000000000000000000000000', // Mints
];

// V5b mode: Disable ERC1155 transfers entirely (they cause more harm than good)
const DISABLE_ERC1155_TRANSFERS = true;

// -----------------------------------------------------------------------------
// Data Loading Functions
// -----------------------------------------------------------------------------

/**
 * Load CLOB fills for a wallet (same as V3)
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
 * Load PayoutRedemption events for a wallet (same as V3)
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
 * Load PositionSplit events for a wallet.
 *
 * A split means the user deposited USDC to mint both YES and NO tokens.
 * Each outcome gets qty tokens at $0.50 cost basis.
 *
 * partition_index_sets: "[1,2]" means binary market (YES=index 0, NO=index 1)
 * The amount is in collateral (USDC with 6 decimals)
 */
export async function getSplitsForWallet(wallet: string): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      condition_id,
      amount_or_payout,
      event_timestamp,
      partition_index_sets
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
    ORDER BY event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const events: ActivityEvent[] = [];

  for (const r of rows) {
    const amount = Number(r.amount_or_payout) / 1e6; // USDC amount (e.g., 34.00)
    const partitionSets = r.partition_index_sets ? JSON.parse(r.partition_index_sets) : [1, 2];

    // For a split, user pays `amount` USDC and receives `amount` tokens of EACH outcome
    // Cost basis per token = $0.50 (the standard Polymarket split price)
    // Total cost = amount USDC, split across outcomes

    for (let i = 0; i < partitionSets.length; i++) {
      events.push({
        condition_id: r.condition_id,
        outcome_index: i,
        event_time: r.event_timestamp,
        event_type: 'SPLIT',
        qty_tokens: amount, // Receive `amount` tokens of each outcome
        usdc_notional: amount * FIFTY_CENTS, // Half of total USDC per outcome
        price: FIFTY_CENTS,
      });
    }
  }

  return events;
}

/**
 * Load PositionsMerge events for a wallet.
 *
 * A merge means the user combined YES + NO tokens back to USDC.
 * This is neutral for PnL - we just remove the positions.
 */
export async function getMergesForWallet(wallet: string): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      condition_id,
      amount_or_payout,
      event_timestamp,
      partition_index_sets
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND event_type = 'PositionsMerge'
      AND is_deleted = 0
    ORDER BY event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const events: ActivityEvent[] = [];

  for (const r of rows) {
    const amount = Number(r.amount_or_payout) / 1e6;
    const partitionSets = r.partition_index_sets ? JSON.parse(r.partition_index_sets) : [1, 2];

    // For a merge, user burns `amount` tokens of EACH outcome and receives USDC back
    // The PnL from merge is (receive_price - cost_basis) * qty
    // Since they receive $1 total for 1 YES + 1 NO, each token "sells" at $0.50

    for (let i = 0; i < partitionSets.length; i++) {
      events.push({
        condition_id: r.condition_id,
        outcome_index: i,
        event_time: r.event_timestamp,
        event_type: 'MERGE',
        qty_tokens: amount,
        usdc_notional: amount * FIFTY_CENTS, // Each side returns $0.50 per token
        price: FIFTY_CENTS, // "Sell" price for each side
      });
    }
  }

  return events;
}

/**
 * Load incoming ERC1155 transfers for a wallet.
 *
 * NOTE: ERC1155 transfer tracking is currently DISABLED (DISABLE_ERC1155_TRANSFERS = true)
 * because most transfers are either:
 * 1. From the Exchange (already counted in CLOB)
 * 2. From NegRisk contracts (internal mechanics)
 * 3. Not representing genuine acquisitions
 *
 * This causes more harm than good by inflating positions without proper cost basis.
 */
export async function getTransfersInForWallet(wallet: string): Promise<ActivityEvent[]> {
  // V5b: Skip transfer tracking entirely - it hurts accuracy
  if (DISABLE_ERC1155_TRANSFERS) {
    return [];
  }

  // Build exclusion list for SQL
  const excludedAddresses = EXCLUDED_TRANSFER_SOURCES.map((a) => `'${a}'`).join(',');

  // Get transfers TO this wallet EXCLUDING known Polymarket contracts
  const query = `
    SELECT
      t.token_id as token_id_hex,
      t.value as value_hex,
      t.block_timestamp as event_time,
      m.condition_id,
      m.outcome_index
    FROM pm_erc1155_transfers t
    INNER JOIN pm_token_to_condition_map_v3 m
      ON toString(reinterpretAsUInt256(reverse(unhex(substring(t.token_id, 3))))) = m.token_id_dec
    WHERE lower(t.to_address) = lower('${wallet}')
      AND lower(t.from_address) NOT IN (${excludedAddresses})
      AND t.is_deleted = 0
    ORDER BY t.block_timestamp ASC
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    return rows.map((r) => {
      // Convert hex value to decimal tokens (6 decimals)
      // value is like "0x19394e50" which needs to be parsed as hex
      const valueHex = r.value_hex.startsWith('0x') ? r.value_hex.slice(2) : r.value_hex;
      const valueDecimal = parseInt(valueHex, 16) / 1e6;

      return {
        condition_id: r.condition_id,
        outcome_index: Number(r.outcome_index),
        event_time: r.event_time,
        event_type: 'TRANSFER_IN' as const,
        qty_tokens: valueDecimal,
        usdc_notional: valueDecimal * TRANSFER_COST_BASIS,
        price: TRANSFER_COST_BASIS,
      };
    });
  } catch (e) {
    // Log but continue without transfers
    console.warn('ERC1155 transfer join failed, skipping transfers:', e);
    return [];
  }
}

/**
 * Load resolution info (same as V3)
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
// Core Algorithm (Extended from V3)
// -----------------------------------------------------------------------------

interface CalculationResult {
  pnl_activity_total: number;
  gain_activity: number;
  loss_activity: number;
  volume_traded: number;
  fills_count: number;
  redemptions_count: number;
  splits_count: number;
  merges_count: number;
  transfers_in_count: number;
  outcomes_traded: number;
  total_events: number;
  resolution_loss_events: number;
  // Debug fields
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution_losses: number;
  pnl_from_splits: number;
  pnl_from_transfers: number;
  clob_buy_count: number;
  clob_sell_count: number;
  volume_buys: number;
  volume_sells: number;
  conditions_with_unredeemed_winners: number;
  conditions_with_unredeemed_losers: number;
}

/**
 * V5 Cost-Basis PnL Calculation Engine
 *
 * Same as V3 but handles:
 * - SPLIT: Add position at $0.50 cost
 * - MERGE: "Sell" position at $0.50 (neutral if also acquired at $0.50)
 * - TRANSFER_IN: Add position at $0.50 cost
 */
export function calculateActivityPnLV5(
  events: ActivityEvent[],
  resolutions: Map<string, ResolutionInfo>
): CalculationResult {
  // Sort all events by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  // State per outcome
  const outcomeStates = new Map<string, OutcomeState>();

  const getKey = (conditionId: string, outcomeIndex: number): string =>
    `${conditionId}_${outcomeIndex}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let fills_count = 0;
  let redemptions_count = 0;
  let splits_count = 0;
  let merges_count = 0;
  let transfers_in_count = 0;
  let clob_buy_count = 0;
  let clob_sell_count = 0;

  // PnL by source
  let pnl_from_clob = 0;
  let pnl_from_redemptions = 0;
  let pnl_from_splits = 0;
  let pnl_from_transfers = 0;

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

    switch (event.event_type) {
      case 'CLOB_BUY':
        clob_buy_count++;
        fills_count++;
        volume_buys += event.usdc_notional;
        volume_traded += event.usdc_notional;
        state.position_cost += event.usdc_notional;
        state.position_qty += event.qty_tokens;
        break;

      case 'CLOB_SELL':
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
        break;

      case 'REDEMPTION':
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
        break;

      case 'SPLIT':
        splits_count++;
        // Add position at $0.50 cost basis
        state.position_cost += event.qty_tokens * FIFTY_CENTS;
        state.position_qty += event.qty_tokens;
        // No realized PnL from split - just acquiring tokens
        break;

      case 'MERGE':
        merges_count++;
        // "Sell" position at $0.50
        if (state.position_qty > 0) {
          const avg_cost = state.position_cost / state.position_qty;
          const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);
          const pnl_now = (FIFTY_CENTS - avg_cost) * qty_to_sell;
          state.realized_pnl += pnl_now;
          pnl_from_splits += pnl_now; // Group with splits for simplicity
          state.position_cost -= avg_cost * qty_to_sell;
          state.position_qty -= qty_to_sell;
        }
        break;

      case 'TRANSFER_IN':
        transfers_in_count++;
        // Add position at $0.50 cost basis (neutral assumption)
        state.position_cost += event.qty_tokens * TRANSFER_COST_BASIS;
        state.position_qty += event.qty_tokens;
        break;
    }
  }

  // PHASE 2: Apply implicit resolution losses (same as V3)
  let resolution_loss_events = 0;
  let pnl_from_resolution_losses = 0;
  let conditions_with_unredeemed_winners = 0;
  let conditions_with_unredeemed_losers = 0;

  const conditionsWithPositions = new Map<string, { winners: number; losers: number }>();

  for (const [key, state] of outcomeStates.entries()) {
    if (state.position_qty <= 0.01) continue;

    const [conditionId, outcomeIndexStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr, 10);
    const resolution = resolutions.get(conditionId.toLowerCase());

    if (!resolution || !resolution.payout_numerators) continue;

    const payout_price = resolution.payout_numerators[outcomeIndex] || 0;

    if (!conditionsWithPositions.has(conditionId)) {
      conditionsWithPositions.set(conditionId, { winners: 0, losers: 0 });
    }
    const stats = conditionsWithPositions.get(conditionId)!;
    if (payout_price > 0) {
      stats.winners++;
    } else {
      stats.losers++;
    }

    const avg_cost = state.position_cost / state.position_qty;
    const pnl_from_resolution = (payout_price - avg_cost) * state.position_qty;

    state.realized_pnl += pnl_from_resolution;
    state.pnl_from_resolution += pnl_from_resolution;
    pnl_from_resolution_losses += pnl_from_resolution;
    state.position_qty = 0;
    state.position_cost = 0;
    resolution_loss_events++;
  }

  for (const stats of conditionsWithPositions.values()) {
    if (stats.winners > 0) conditions_with_unredeemed_winners++;
    if (stats.losers > 0) conditions_with_unredeemed_losers++;
  }

  // Aggregate
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
    splits_count,
    merges_count,
    transfers_in_count,
    outcomes_traded: outcomeStates.size,
    total_events: events.length,
    resolution_loss_events,
    pnl_from_clob,
    pnl_from_redemptions,
    pnl_from_resolution_losses,
    pnl_from_splits,
    pnl_from_transfers,
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
 * Compute V5 Activity PnL for a single wallet.
 */
export async function computeWalletActivityPnlV5(wallet: string): Promise<WalletActivityMetricsV5> {
  // Load all event types
  const [clobFills, redemptions, splits, merges, transfersIn] = await Promise.all([
    getClobFillsForWallet(wallet),
    getRedemptionsForWallet(wallet),
    getSplitsForWallet(wallet),
    getMergesForWallet(wallet),
    getTransfersInForWallet(wallet),
  ]);

  const allEvents = [...clobFills, ...redemptions, ...splits, ...merges, ...transfersIn];

  // Get resolutions
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];
  const resolutions = await getResolutionsForConditions(conditionIds);

  // Calculate
  const metrics = calculateActivityPnLV5(allEvents, resolutions);

  return {
    wallet,
    pnl_activity_total: metrics.pnl_activity_total,
    gain_activity: metrics.gain_activity,
    loss_activity: metrics.loss_activity,
    volume_traded: metrics.volume_traded,
    fills_count: metrics.fills_count,
    redemptions_count: metrics.redemptions_count,
    splits_count: metrics.splits_count,
    merges_count: metrics.merges_count,
    transfers_in_count: metrics.transfers_in_count,
  };
}

/**
 * Compute V5 Activity PnL with full debug info.
 */
export async function computeWalletActivityPnlV5Debug(
  wallet: string
): Promise<WalletActivityMetricsV5Debug> {
  // Load all event types
  const [clobFills, redemptions, splits, merges, transfersIn] = await Promise.all([
    getClobFillsForWallet(wallet),
    getRedemptionsForWallet(wallet),
    getSplitsForWallet(wallet),
    getMergesForWallet(wallet),
    getTransfersInForWallet(wallet),
  ]);

  const allEvents = [...clobFills, ...redemptions, ...splits, ...merges, ...transfersIn];

  // Get resolutions
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];
  const resolutions = await getResolutionsForConditions(conditionIds);

  // Calculate
  const metrics = calculateActivityPnLV5(allEvents, resolutions);

  return {
    wallet,
    pnl_activity_total: metrics.pnl_activity_total,
    gain_activity: metrics.gain_activity,
    loss_activity: metrics.loss_activity,
    volume_traded: metrics.volume_traded,
    fills_count: metrics.fills_count,
    redemptions_count: metrics.redemptions_count,
    splits_count: metrics.splits_count,
    merges_count: metrics.merges_count,
    transfers_in_count: metrics.transfers_in_count,
    outcomes_traded: metrics.outcomes_traded,
    total_events: metrics.total_events,
    resolution_loss_events: metrics.resolution_loss_events,
    pnl_from_clob: metrics.pnl_from_clob,
    pnl_from_redemptions: metrics.pnl_from_redemptions,
    pnl_from_resolution_losses: metrics.pnl_from_resolution_losses,
    pnl_from_splits: metrics.pnl_from_splits,
    pnl_from_transfers: metrics.pnl_from_transfers,
    clob_buy_count: metrics.clob_buy_count,
    clob_sell_count: metrics.clob_sell_count,
    volume_buys: metrics.volume_buys,
    volume_sells: metrics.volume_sells,
    conditions_with_unredeemed_winners: metrics.conditions_with_unredeemed_winners,
    conditions_with_unredeemed_losers: metrics.conditions_with_unredeemed_losers,
  };
}
