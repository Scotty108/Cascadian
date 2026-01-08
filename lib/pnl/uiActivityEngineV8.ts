/**
 * UI Activity PnL Engine V8
 *
 * ============================================================================
 * V8: OPTIMIZED FOR BATCH PROCESSING - SCALES TO ALL WALLETS
 * Session: 2025-11-29
 * ============================================================================
 *
 * KEY IMPROVEMENT over V7: Pre-loads ALL resolutions into memory cache.
 * This eliminates the N-query resolution lookup that caused timeouts.
 *
 * V7 Problem: getResolutionsForConditions() generates huge IN(...) clauses
 * that exceed max_query_size for high-volume wallets (>10K conditions).
 *
 * V8 Solution: Load all 194K resolutions once (~5 seconds), then process
 * any wallet instantly without additional resolution queries.
 *
 * Usage:
 * ```typescript
 * // Initialize once
 * const engine = await createV8Engine();
 *
 * // Process many wallets
 * const results = await engine.computeBatch(wallets);
 * const single = await engine.compute(wallet);
 * ```
 *
 * Performance:
 * - Initialization: ~5 seconds (loads all resolutions)
 * - Per-wallet: ~100-500ms (depends on trade count)
 * - Batch of 100 wallets: ~30-60 seconds
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types (same as V7)
// -----------------------------------------------------------------------------

export type RealizationMode = 'symmetric' | 'asymmetric';

export interface V8Options {
  mode?: RealizationMode;
}

export interface WalletMetricsV8 {
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

  // V8-specific
  unrealized_winner_value: number;
  unredeemed_winner_count: number;

  // Debug
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution: number;
}

interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
}

interface ActivityEvent {
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type: 'CLOB_BUY' | 'CLOB_SELL' | 'REDEMPTION';
  qty_tokens: number;
  usdc_notional: number;
  price: number;
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

let globalResolutionCache: Map<string, ResolutionInfo> | null = null;

/**
 * Load ALL resolutions into memory. Called once at engine initialization.
 */
async function loadAllResolutions(): Promise<Map<string, ResolutionInfo>> {
  console.log('[V8] Loading all resolutions into cache...');
  const start = Date.now();

  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        payout_numerators
      FROM pm_condition_resolutions
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const cache = new Map<string, ResolutionInfo>();

  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    cache.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: payouts,
    });
  }

  const elapsed = Date.now() - start;
  console.log(`[V8] Loaded ${cache.size} resolutions in ${elapsed}ms`);

  return cache;
}

/**
 * Get resolutions for conditions from cache (instant lookup).
 */
function getResolutionsFromCache(
  conditionIds: string[],
  cache: Map<string, ResolutionInfo>
): Map<string, ResolutionInfo> {
  const result = new Map<string, ResolutionInfo>();
  for (const cid of conditionIds) {
    const key = cid.toLowerCase();
    const res = cache.get(key);
    if (res) {
      result.set(key, res);
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

async function getClobFillsForWallet(wallet: string): Promise<ActivityEvent[]> {
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

async function getRedemptionsForWallet(wallet: string): Promise<ActivityEvent[]> {
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

// -----------------------------------------------------------------------------
// Core Algorithm (same as V7)
// -----------------------------------------------------------------------------

interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
  pnl_from_clob: number;
  pnl_from_redemptions: number;
  pnl_from_resolution: number;
}

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
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  const states = new Map<string, OutcomeState>();
  const getKey = (cid: string, idx: number) => `${cid}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let fills_count = 0;
  let redemptions_count = 0;
  let pnl_from_clob = 0;
  let pnl_from_redemptions = 0;

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

  // Phase 2: Implicit resolution
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
      if (mode === 'symmetric') {
        state.realized_pnl += potential_pnl;
        state.pnl_from_resolution += potential_pnl;
        pnl_from_resolution += potential_pnl;
        state.position_qty = 0;
        state.position_cost = 0;
      } else {
        unrealized_winner_value += potential_pnl;
        unredeemed_winner_count++;
      }
    } else {
      state.realized_pnl += potential_pnl;
      state.pnl_from_resolution += potential_pnl;
      pnl_from_resolution += potential_pnl;
      state.position_qty = 0;
      state.position_cost = 0;
    }
  }

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
// V8 Engine Class
// -----------------------------------------------------------------------------

export class V8Engine {
  private resolutionCache: Map<string, ResolutionInfo>;

  constructor(cache: Map<string, ResolutionInfo>) {
    this.resolutionCache = cache;
  }

  /**
   * Compute PnL for a single wallet.
   */
  async compute(wallet: string, options: V8Options = {}): Promise<WalletMetricsV8> {
    const mode = options.mode || 'asymmetric';

    const [clobFills, redemptions] = await Promise.all([
      getClobFillsForWallet(wallet),
      getRedemptionsForWallet(wallet),
    ]);

    const allEvents = [...clobFills, ...redemptions];
    const conditionIds = [...new Set(allEvents.map((e) => e.condition_id))];

    // Use cache instead of querying
    const resolutions = getResolutionsFromCache(conditionIds, this.resolutionCache);

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
   * Compute PnL for multiple wallets with progress reporting.
   */
  async computeBatch(
    wallets: string[],
    options: V8Options = {},
    batchSize: number = 5,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WalletMetricsV8[]> {
    const results: WalletMetricsV8[] = [];

    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((wallet) =>
          this.compute(wallet, options).catch((err) => {
            console.error(`Error for ${wallet}: ${err.message}`);
            return null;
          })
        )
      );
      results.push(...(batchResults.filter((r) => r !== null) as WalletMetricsV8[]));

      if (onProgress) {
        onProgress(Math.min(i + batchSize, wallets.length), wallets.length);
      }
    }

    return results;
  }

  /**
   * Get cache stats.
   */
  getCacheStats(): { resolutionCount: number } {
    return {
      resolutionCount: this.resolutionCache.size,
    };
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

/**
 * Create a V8 engine instance with pre-loaded resolution cache.
 *
 * Call this once at startup, then use the engine for all wallet calculations.
 */
export async function createV8Engine(): Promise<V8Engine> {
  // Use global cache if already loaded
  if (!globalResolutionCache) {
    globalResolutionCache = await loadAllResolutions();
  }
  return new V8Engine(globalResolutionCache);
}

/**
 * Clear the global resolution cache (useful for testing or refresh).
 */
export function clearV8Cache(): void {
  globalResolutionCache = null;
}
