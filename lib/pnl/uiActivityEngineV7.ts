/**
 * UI Activity PnL Engine V7
 *
 * ============================================================================
 * V7: ASYMMETRIC REALIZATION MODE - FIXES OVERESTIMATION BUG
 * Session: 2025-11-29
 * ============================================================================
 *
 * KEY FIX: V3-V6 OVERESTIMATE performance (5/6 wallets appear better than they are).
 * This makes losers look like winners on leaderboards - DANGEROUS for smart money detection.
 *
 * ROOT CAUSE: V3-V6 realize ALL unredeemed positions at resolution time.
 * - If you hold winning tokens and never redeem, earlier engines count it as profit.
 * - But Polymarket UI doesn't count unredeemed winning tokens as realized.
 *
 * V7 FIX: Asymmetric Realization (DEFAULT)
 * - LOSERS: Realized at resolution (payout=0, tokens worthless)
 * - WINNERS: NOT realized until actual PayoutRedemption event
 *
 * MODES:
 * - 'asymmetric' (DEFAULT): Only realize losers. Conservative, matches Polymarket UI.
 * - 'symmetric': Realize all (V3-V6 behavior). Economically correct but overestimates.
 *
 * Usage:
 * ```typescript
 * // Safe for leaderboards (default)
 * await computeWalletPnlV7(wallet);
 * await computeWalletPnlV7(wallet, { mode: 'asymmetric' });
 *
 * // V3 compatible (overestimates)
 * await computeWalletPnlV7(wallet, { mode: 'symmetric' });
 * ```
 *
 * Directional Bias Analysis (from W1-W6 benchmarks):
 * - V3 (symmetric): 5/6 wallets OVERESTIMATED → losers could look like winners
 * - V7 (asymmetric): Winners look CONSERVATIVE → safe for leaderboards
 *
 * Reference: docs/systems/pnl/PHASE2_COVERAGE_AUDIT_RESULTS.md
 */

import { clickhouse } from '../clickhouse/client';
import {
  ActivityEvent,
  ResolutionInfo,
  getClobFillsForWallet,
  getRedemptionsForWallet,
  getResolutionsForConditions,
} from './uiActivityEngineV3';

// Re-export common types
export type { ActivityEvent, ResolutionInfo };

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Realization mode controls how unredeemed positions are handled.
 */
export type RealizationMode = 'symmetric' | 'asymmetric';

/**
 * V7 engine options.
 */
export interface V7Options {
  /**
   * Realization mode:
   * - 'asymmetric' (default): Only realize losers. Safe for leaderboards.
   * - 'symmetric': Realize all positions (V3-V6 behavior). Overestimates.
   */
  mode?: RealizationMode;
}

/**
 * V7 wallet metrics with realization mode info.
 */
export interface WalletMetricsV7 {
  wallet: string;
  mode: RealizationMode;

  // Core PnL
  pnl_total: number;
  gain: number;
  loss: number;

  // Volume
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;

  // Counts
  fills_count: number;
  redemptions_count: number;
  outcomes_traded: number;

  // V7-specific: Unredeemed winners (only tracked in asymmetric mode)
  unrealized_winner_value: number;
  unredeemed_winner_count: number;

  // Debug: PnL decomposition
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution: number;
}

// -----------------------------------------------------------------------------
// Core Algorithm
// -----------------------------------------------------------------------------

interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution: number;
}

/**
 * Calculate PnL with configurable realization mode.
 */
function calculatePnL(
  events: ActivityEvent[],
  resolutions: Map<string, ResolutionInfo>,
  mode: RealizationMode
): {
  pnl_total: number;
  gain: number;
  loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  fills_count: number;
  redemptions_count: number;
  outcomes_traded: number;
  unrealized_winner_value: number;
  unredeemed_winner_count: number;
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution: number;
} {
  // Sort events by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  // State per outcome
  const states = new Map<string, OutcomeState>();
  const getKey = (cid: string, idx: number) => `${cid}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let fills_count = 0;
  let redemptions_count = 0;
  let pnl_from_clob = 0;
  let pnl_from_redemptions = 0;

  // Process events
  for (const event of events) {
    const key = getKey(event.condition_id, event.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        position_qty: 0,
        position_cost: 0,
        realized_pnl: 0,
        pnl_from_clob: 0,
        pnl_from_redemptions: 0,
        pnl_from_resolution: 0,
      });
    }

    const state = states.get(key)!;

    if (event.event_type === 'CLOB_BUY') {
      fills_count++;
      volume_buys += event.usdc_notional;
      volume_traded += event.usdc_notional;
      state.position_cost += event.usdc_notional;
      state.position_qty += event.qty_tokens;
    } else if (event.event_type === 'CLOB_SELL') {
      fills_count++;
      volume_sells += event.usdc_notional;
      volume_traded += event.usdc_notional;

      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty = Math.min(event.qty_tokens, state.position_qty);
        const pnl = (event.price - avg_cost) * qty;
        state.realized_pnl += pnl;
        state.pnl_from_clob += pnl;
        pnl_from_clob += pnl;
        state.position_cost -= avg_cost * qty;
        state.position_qty -= qty;
      }
    } else if (event.event_type === 'REDEMPTION') {
      redemptions_count++;

      if (state.position_qty > 0) {
        const avg_cost = state.position_cost / state.position_qty;
        const qty = Math.min(event.qty_tokens, state.position_qty);
        const pnl = (event.price - avg_cost) * qty;
        state.realized_pnl += pnl;
        state.pnl_from_redemptions += pnl;
        pnl_from_redemptions += pnl;
        state.position_cost -= avg_cost * qty;
        state.position_qty -= qty;
      }
    }
  }

  // PHASE 2: Implicit resolution
  // KEY DIFFERENCE: asymmetric mode only realizes LOSERS
  let pnl_from_resolution = 0;
  let unrealized_winner_value = 0;
  let unredeemed_winner_count = 0;

  for (const [key, state] of states.entries()) {
    if (state.position_qty <= 0.01) continue;

    const [conditionId, outcomeIndexStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeIndexStr, 10);
    const resolution = resolutions.get(conditionId.toLowerCase());

    if (!resolution || !resolution.payout_numerators) continue;

    const payout = resolution.payout_numerators[outcomeIndex] || 0;
    const avg_cost = state.position_cost / state.position_qty;
    const potential_pnl = (payout - avg_cost) * state.position_qty;

    if (payout > 0) {
      // WINNER
      if (mode === 'symmetric') {
        // Realize the gain (V3-V6 behavior)
        state.realized_pnl += potential_pnl;
        state.pnl_from_resolution += potential_pnl;
        pnl_from_resolution += potential_pnl;
        state.position_qty = 0;
        state.position_cost = 0;
      } else {
        // ASYMMETRIC: Don't realize, track as unrealized
        unrealized_winner_value += potential_pnl;
        unredeemed_winner_count++;
        // Position stays - not realized!
      }
    } else {
      // LOSER - always realize (tokens are worthless)
      state.realized_pnl += potential_pnl;
      state.pnl_from_resolution += potential_pnl;
      pnl_from_resolution += potential_pnl;
      state.position_qty = 0;
      state.position_cost = 0;
    }
  }

  // Aggregate
  let pnl_total = 0;
  let gain = 0;
  let loss = 0;

  for (const state of states.values()) {
    pnl_total += state.realized_pnl;
    if (state.realized_pnl > 0) {
      gain += state.realized_pnl;
    } else {
      loss += state.realized_pnl;
    }
  }

  return {
    pnl_total,
    gain,
    loss,
    volume_traded,
    volume_buys,
    volume_sells,
    fills_count,
    redemptions_count,
    outcomes_traded: states.size,
    unrealized_winner_value,
    unredeemed_winner_count,
    pnl_from_clob,
    pnl_from_redemptions,
    pnl_from_resolution,
  };
}

// -----------------------------------------------------------------------------
// Main Entry Points
// -----------------------------------------------------------------------------

/**
 * Compute V7 PnL for a wallet.
 *
 * @param wallet - Wallet address
 * @param options - { mode: 'asymmetric' | 'symmetric' }. Default: 'asymmetric'
 */
export async function computeWalletPnlV7(
  wallet: string,
  options: V7Options = {}
): Promise<WalletMetricsV7> {
  const mode = options.mode || 'asymmetric';

  const [clobFills, redemptions] = await Promise.all([
    getClobFillsForWallet(wallet),
    getRedemptionsForWallet(wallet),
  ]);

  const allEvents = [...clobFills, ...redemptions];
  const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];
  const resolutions = await getResolutionsForConditions(conditionIds);

  const result = calculatePnL(allEvents, resolutions, mode);

  return {
    wallet,
    mode,
    pnl_total: result.pnl_total,
    gain: result.gain,
    loss: result.loss,
    volume_traded: result.volume_traded,
    volume_buys: result.volume_buys,
    volume_sells: result.volume_sells,
    fills_count: result.fills_count,
    redemptions_count: result.redemptions_count,
    outcomes_traded: result.outcomes_traded,
    unrealized_winner_value: result.unrealized_winner_value,
    unredeemed_winner_count: result.unredeemed_winner_count,
    pnl_from_clob: result.pnl_from_clob,
    pnl_from_redemptions: result.pnl_from_redemptions,
    pnl_from_resolution: result.pnl_from_resolution,
  };
}

/**
 * Compare both modes for a wallet.
 * Useful for understanding impact of realization mode.
 */
export async function compareModes(wallet: string): Promise<{
  symmetric: WalletMetricsV7;
  asymmetric: WalletMetricsV7;
  difference: number;
  mode_matters: boolean;
}> {
  const [symmetric, asymmetric] = await Promise.all([
    computeWalletPnlV7(wallet, { mode: 'symmetric' }),
    computeWalletPnlV7(wallet, { mode: 'asymmetric' }),
  ]);

  const difference = symmetric.pnl_total - asymmetric.pnl_total;

  return {
    symmetric,
    asymmetric,
    difference,
    mode_matters: Math.abs(difference) > 1,
  };
}

/**
 * Batch compute V7 PnL for multiple wallets.
 * Useful for leaderboard generation.
 *
 * @param wallets - Array of wallet addresses
 * @param options - V7Options including mode
 * @param batchSize - Number of wallets to process in parallel (default: 10)
 */
export async function computeBatchPnlV7(
  wallets: string[],
  options: V7Options = {},
  batchSize: number = 10
): Promise<WalletMetricsV7[]> {
  const results: WalletMetricsV7[] = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((wallet) => computeWalletPnlV7(wallet, options))
    );
    results.push(...batchResults);
  }

  return results;
}
