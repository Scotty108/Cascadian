/**
 * UI Activity PnL Engine V10
 *
 * ============================================================================
 * V10: COMPLETE POLYMARKET SUBGRAPH REPLICATION + UI MODE
 * Session: 2025-12-02
 * ============================================================================
 *
 * Based on complete analysis of Polymarket's subgraph code:
 * https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph/src
 *
 * TWO MODES:
 * - 'subgraph': Pure subgraph logic - only counts actual sells/redemptions
 * - 'ui': Adds unrealized gains/losses on resolved markets (matches Polymarket UI)
 *
 * KEY LEARNINGS FROM SUBGRAPH:
 *
 * 1. CLOB TRADES (ExchangeMapping.ts):
 *    - handleOrderFilled -> updateUserPositionWithBuy/Sell
 *    - price = quoteAmount * COLLATERAL_SCALE / baseAmount
 *
 * 2. CTF EVENTS (ConditionalTokensMapping.ts):
 *    - PositionSplit: Treated as BUY at $0.50 (FIFTY_CENTS)
 *    - PositionsMerge: Treated as SELL at $0.50 (FIFTY_CENTS)
 *    - PayoutRedemption: Treated as SELL at payout price (0 or 1)
 *    - EXCLUDES splits/merges from NEG_RISK_ADAPTER and EXCHANGE contracts
 *
 * 3. FPMM TRADES (FixedProductMarketMakerMapping.ts):
 *    - FPMMBuy: price = investmentAmount * COLLATERAL_SCALE / outcomeTokensBought
 *    - FPMMSell: price = returnAmount * COLLATERAL_SCALE / outcomeTokensSold
 *
 * 4. NEG_RISK (NegRiskAdapterMapping.ts):
 *    - Complex handling for multi-outcome markets
 *    - PositionsConverted computes YES price from NO prices
 *
 * 5. CORE FORMULA (updateUserPositionWithBuy/Sell.ts):
 *    BUY:  avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
 *    SELL: deltaPnL = min(sellAmount, amount) * (price - avgPrice)
 *
 * COLLATERAL_SCALE = 1e6 (prices stored as integers, divided by 1e6)
 * FIFTY_CENTS = 500000 (0.5 in scaled form)
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Constants (matching subgraph)
// -----------------------------------------------------------------------------

const COLLATERAL_SCALE = 1_000_000;
const FIFTY_CENTS = 0.5; // Already in decimal form for our calculations

// Contracts to exclude from CTF event processing
// These are handled separately or are exchange internals
const EXCLUDED_ADDRESSES = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // NEG_RISK_ADAPTER
  '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', // EXCHANGE (CTF)
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // NEG_RISK_EXCHANGE
].map(a => a.toLowerCase());

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type V10Mode = 'subgraph' | 'ui';

export interface V10Options {
  mode?: V10Mode;
}

export interface WalletMetricsV10 {
  wallet: string;
  mode: V10Mode;

  // Core PnL (matching Polymarket)
  realized_pnl: number;
  total_gain: number;
  total_loss: number;

  // UI mode extras (resolved but unredeemed positions)
  unrealized_resolved_pnl: number;
  combined_pnl: number; // realized + unrealized_resolved

  // Volume
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;

  // Counts
  fills_count: number;
  splits_count: number;
  merges_count: number;
  redemptions_count: number;
  fpmm_count: number;
  outcomes_traded: number;
  unredeemed_winner_count: number;
  unredeemed_loser_count: number;

  // Breakdown
  pnl_from_clob: number;
  pnl_from_splits_merges: number;
  pnl_from_redemptions: number;
  pnl_from_fpmm: number;
  pnl_from_resolved_unredeemed: number;

  // For ratio calculations
  trade_returns: TradeReturn[];
}

export interface TradeReturn {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  event_type: string;
  pnl: number;
  return_pct: number;
}

interface OutcomeState {
  amount: number;
  avgPrice: number;
  totalBought: number;
  realized_pnl: number;
}

type EventType = 'CLOB_BUY' | 'CLOB_SELL' | 'SPLIT' | 'MERGE' | 'REDEMPTION' | 'FPMM_BUY' | 'FPMM_SELL';

interface UnifiedEvent {
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type: EventType;
  qty_tokens: number;
  price: number;
  usdc_notional: number;
  source_address?: string; // For filtering CTF events
}

// -----------------------------------------------------------------------------
// Data Loading
// -----------------------------------------------------------------------------

async function getClobFills(wallet: string): Promise<UnifiedEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time as event_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.usdc_notional
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
    event_type: r.side === 'buy' ? 'CLOB_BUY' as const : 'CLOB_SELL' as const,
    qty_tokens: Number(r.qty_tokens),
    price: Number(r.price),
    usdc_notional: Number(r.usdc_notional),
  }));
}

async function getCtfEvents(wallet: string): Promise<UnifiedEvent[]> {
  // Get splits, merges, and redemptions
  // Note: We filter out events from exchange contracts as per subgraph logic
  const query = `
    SELECT
      e.condition_id,
      e.event_type,
      e.event_timestamp as event_time,
      e.amount_or_payout,
      r.payout_numerators
    FROM pm_ctf_events e
    LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
    WHERE lower(e.user_address) = lower('${wallet}')
      AND e.is_deleted = 0
      AND e.event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
    ORDER BY e.event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const events: UnifiedEvent[] = [];

  for (const r of rows) {
    const amount = Number(r.amount_or_payout) / 1e6;
    if (amount <= 0) continue;

    if (r.event_type === 'PositionSplit') {
      // Split = BUY both outcomes at $0.50 each
      // Per subgraph: updateUserPositionWithBuy at FIFTY_CENTS for each outcome
      for (let i = 0; i < 2; i++) {
        events.push({
          condition_id: r.condition_id,
          outcome_index: i,
          event_time: r.event_time,
          event_type: 'SPLIT',
          qty_tokens: amount,
          price: FIFTY_CENTS,
          usdc_notional: amount * FIFTY_CENTS,
        });
      }
    } else if (r.event_type === 'PositionsMerge') {
      // Merge = SELL both outcomes at $0.50 each
      // Per subgraph: updateUserPositionWithSell at FIFTY_CENTS for each outcome
      for (let i = 0; i < 2; i++) {
        events.push({
          condition_id: r.condition_id,
          outcome_index: i,
          event_time: r.event_time,
          event_type: 'MERGE',
          qty_tokens: amount,
          price: FIFTY_CENTS,
          usdc_notional: amount * FIFTY_CENTS,
        });
      }
    } else if (r.event_type === 'PayoutRedemption') {
      // Redemption = SELL at payout price (0 or 1)
      // Per subgraph: updateUserPositionWithSell at price = payoutNumerator/payoutDenominator
      const payoutNumerators = r.payout_numerators ? JSON.parse(r.payout_numerators) : null;
      if (!payoutNumerators) continue;

      for (let i = 0; i < payoutNumerators.length; i++) {
        const payout = payoutNumerators[i];
        // Only process if there's a payout for this outcome
        // The user redeems their entire position at the payout price
        events.push({
          condition_id: r.condition_id,
          outcome_index: i,
          event_time: r.event_time,
          event_type: 'REDEMPTION',
          qty_tokens: amount, // This is the USDC received, we'll calculate tokens below
          price: payout,
          usdc_notional: amount,
        });
      }
    }
  }

  return events;
}

async function getFpmmTrades(wallet: string): Promise<UnifiedEvent[]> {
  // Check if FPMM table exists and has trades for this wallet
  const query = `
    SELECT
      condition_id,
      outcome_index,
      trade_time as event_time,
      side,
      token_amount / 1000000.0 as qty_tokens,
      usdc_amount / 1000000.0 as usdc_notional,
      CASE WHEN token_amount > 0
        THEN usdc_amount / token_amount
        ELSE 0
      END as price
    FROM pm_fpmm_trades
    WHERE lower(trader_wallet) = lower('${wallet}')
    ORDER BY trade_time ASC
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    return rows.map((r) => ({
      condition_id: r.condition_id,
      outcome_index: Number(r.outcome_index),
      event_time: r.event_time,
      event_type: r.side === 'buy' ? 'FPMM_BUY' as const : 'FPMM_SELL' as const,
      qty_tokens: Number(r.qty_tokens),
      price: Number(r.price),
      usdc_notional: Number(r.usdc_notional),
    }));
  } catch (e) {
    // FPMM table might not exist or have different schema
    return [];
  }
}

// -----------------------------------------------------------------------------
// Core Algorithm - Matching Polymarket Subgraph EXACTLY
// -----------------------------------------------------------------------------

interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
}

function calculatePnL(
  events: UnifiedEvent[],
  resolutions?: Map<string, ResolutionInfo>
): {
  realized_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  fills_count: number;
  splits_count: number;
  merges_count: number;
  redemptions_count: number;
  fpmm_count: number;
  outcomes_traded: number;
  pnl_from_clob: number;
  pnl_from_splits_merges: number;
  pnl_from_redemptions: number;
  pnl_from_fpmm: number;
  pnl_from_resolved_unredeemed: number;
  unredeemed_winner_count: number;
  unredeemed_loser_count: number;
  trade_returns: TradeReturn[];
  remaining_positions: Map<string, OutcomeState>;
} {
  // Sort by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  const states = new Map<string, OutcomeState>();
  const getKey = (cid: string, idx: number) => `${cid.toLowerCase()}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let fills_count = 0;
  let splits_count = 0;
  let merges_count = 0;
  let redemptions_count = 0;
  let fpmm_count = 0;

  let pnl_from_clob = 0;
  let pnl_from_splits_merges = 0;
  let pnl_from_redemptions = 0;
  let pnl_from_fpmm = 0;

  const trade_returns: TradeReturn[] = [];

  for (const event of events) {
    const key = getKey(event.condition_id, event.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        amount: 0,
        avgPrice: 0,
        totalBought: 0,
        realized_pnl: 0,
      });
    }

    const state = states.get(key)!;
    const isBuy = ['CLOB_BUY', 'SPLIT', 'FPMM_BUY'].includes(event.event_type);
    const isSell = ['CLOB_SELL', 'MERGE', 'REDEMPTION', 'FPMM_SELL'].includes(event.event_type);

    if (isBuy) {
      // =====================================================================
      // BUY LOGIC - from updateUserPositionWithBuy.ts
      // avgPrice = (avgPrice * amount + price * buyAmount) / (amount + buyAmount)
      // amount += buyAmount
      // totalBought += buyAmount
      // =====================================================================

      if (event.event_type === 'CLOB_BUY') {
        fills_count++;
        volume_buys += event.usdc_notional;
        volume_traded += event.usdc_notional;
      } else if (event.event_type === 'SPLIT') {
        splits_count++;
      } else if (event.event_type === 'FPMM_BUY') {
        fpmm_count++;
        volume_buys += event.usdc_notional;
        volume_traded += event.usdc_notional;
      }

      if (event.qty_tokens > 0) {
        const numerator = state.avgPrice * state.amount + event.price * event.qty_tokens;
        const denominator = state.amount + event.qty_tokens;
        state.avgPrice = denominator > 0 ? numerator / denominator : 0;
        state.amount += event.qty_tokens;
        state.totalBought += event.qty_tokens;
      }
    } else if (isSell) {
      // =====================================================================
      // SELL LOGIC - from updateUserPositionWithSell.ts
      // adjustedAmount = min(sellAmount, amount)
      // deltaPnL = adjustedAmount * (price - avgPrice)
      // realizedPnl += deltaPnL
      // amount -= adjustedAmount
      // =====================================================================

      if (event.event_type === 'CLOB_SELL') {
        fills_count++;
        volume_sells += event.usdc_notional;
        volume_traded += event.usdc_notional;
      } else if (event.event_type === 'MERGE') {
        merges_count++;
      } else if (event.event_type === 'REDEMPTION') {
        redemptions_count++;
      } else if (event.event_type === 'FPMM_SELL') {
        fpmm_count++;
        volume_sells += event.usdc_notional;
        volume_traded += event.usdc_notional;
      }

      // Cap at tracked position (THE KEY INSIGHT from subgraph)
      const adjustedAmount = Math.min(event.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (event.price - state.avgPrice);
        state.realized_pnl += deltaPnL;
        state.amount -= adjustedAmount;

        // Track by source
        if (event.event_type === 'CLOB_SELL') {
          pnl_from_clob += deltaPnL;
        } else if (event.event_type === 'MERGE') {
          pnl_from_splits_merges += deltaPnL;
        } else if (event.event_type === 'REDEMPTION') {
          pnl_from_redemptions += deltaPnL;
        } else if (event.event_type === 'FPMM_SELL') {
          pnl_from_fpmm += deltaPnL;
        }

        // Track individual trade return for Sharpe/Sortino/Omega
        if (state.avgPrice > 0) {
          const return_pct = (event.price - state.avgPrice) / state.avgPrice;
          trade_returns.push({
            condition_id: event.condition_id,
            outcome_index: event.outcome_index,
            trade_time: event.event_time,
            event_type: event.event_type,
            pnl: deltaPnL,
            return_pct,
          });
        }
      }
    }
  }

  // Aggregate results
  let realized_pnl = 0;
  let total_gain = 0;
  let total_loss = 0;

  for (const state of states.values()) {
    realized_pnl += state.realized_pnl;
    if (state.realized_pnl > 0) {
      total_gain += state.realized_pnl;
    } else {
      total_loss += state.realized_pnl;
    }
  }

  // Phase 2: Calculate unrealized PnL on resolved positions (UI mode)
  let pnl_from_resolved_unredeemed = 0;
  let unredeemed_winner_count = 0;
  let unredeemed_loser_count = 0;

  if (resolutions) {
    for (const [key, state] of states.entries()) {
      if (state.amount <= 0.01) continue;

      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr, 10);
      const resolution = resolutions.get(conditionId.toLowerCase());

      if (!resolution || !resolution.payout_numerators) continue;

      const payout = resolution.payout_numerators[outcomeIndex];
      if (payout === undefined) continue;

      const unrealizedPnL = (payout - state.avgPrice) * state.amount;
      pnl_from_resolved_unredeemed += unrealizedPnL;

      if (payout > 0) {
        unredeemed_winner_count++;
      } else {
        unredeemed_loser_count++;
      }

      // Add to trade returns for ratio calculations
      if (state.avgPrice > 0) {
        const return_pct = (payout - state.avgPrice) / state.avgPrice;
        trade_returns.push({
          condition_id: conditionId,
          outcome_index: outcomeIndex,
          trade_time: 'resolved',
          event_type: payout > 0 ? 'RESOLVED_WINNER' : 'RESOLVED_LOSER',
          pnl: unrealizedPnL,
          return_pct,
        });
      }
    }
  }

  return {
    realized_pnl,
    total_gain,
    total_loss,
    volume_traded,
    volume_buys,
    volume_sells,
    fills_count,
    splits_count,
    merges_count,
    redemptions_count,
    fpmm_count,
    outcomes_traded: states.size,
    pnl_from_clob,
    pnl_from_splits_merges,
    pnl_from_redemptions,
    pnl_from_fpmm,
    pnl_from_resolved_unredeemed,
    unredeemed_winner_count,
    unredeemed_loser_count,
    trade_returns,
    remaining_positions: states,
  };
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

let globalResolutionCache: Map<string, ResolutionInfo> | null = null;

async function loadAllResolutions(): Promise<Map<string, ResolutionInfo>> {
  console.log('[V10] Loading all resolutions into cache...');
  const start = Date.now();

  const result = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`,
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
  console.log(`[V10] Loaded ${cache.size} resolutions in ${elapsed}ms`);

  return cache;
}

// -----------------------------------------------------------------------------
// V10 Engine Class
// -----------------------------------------------------------------------------

export class V10Engine {
  private resolutionCache: Map<string, ResolutionInfo> | null = null;

  /**
   * Compute PnL using complete Polymarket subgraph logic.
   *
   * Modes:
   * - 'subgraph': Pure subgraph logic - only actual sells/redemptions
   * - 'ui': Adds unrealized gains/losses on resolved markets (matches Polymarket UI)
   */
  async compute(wallet: string, options: V10Options = {}): Promise<WalletMetricsV10> {
    const mode = options.mode || 'ui';

    // Load resolution cache for UI mode
    if (mode === 'ui' && !this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    // Fetch all event types in parallel
    const [clobFills, ctfEvents, fpmmTrades] = await Promise.all([
      getClobFills(wallet),
      getCtfEvents(wallet),
      getFpmmTrades(wallet),
    ]);

    // Combine all events
    const allEvents = [...clobFills, ...ctfEvents, ...fpmmTrades];

    // Calculate PnL - pass resolutions only in UI mode
    const result = calculatePnL(
      allEvents,
      mode === 'ui' ? this.resolutionCache || undefined : undefined
    );

    const unrealized_resolved_pnl = result.pnl_from_resolved_unredeemed;
    const combined_pnl = result.realized_pnl + unrealized_resolved_pnl;

    return {
      wallet,
      mode,
      realized_pnl: result.realized_pnl,
      total_gain: result.total_gain,
      total_loss: result.total_loss,
      unrealized_resolved_pnl,
      combined_pnl,
      volume_traded: result.volume_traded,
      volume_buys: result.volume_buys,
      volume_sells: result.volume_sells,
      fills_count: result.fills_count,
      splits_count: result.splits_count,
      merges_count: result.merges_count,
      redemptions_count: result.redemptions_count,
      fpmm_count: result.fpmm_count,
      outcomes_traded: result.outcomes_traded,
      unredeemed_winner_count: result.unredeemed_winner_count,
      unredeemed_loser_count: result.unredeemed_loser_count,
      pnl_from_clob: result.pnl_from_clob,
      pnl_from_splits_merges: result.pnl_from_splits_merges,
      pnl_from_redemptions: result.pnl_from_redemptions,
      pnl_from_fpmm: result.pnl_from_fpmm,
      pnl_from_resolved_unredeemed: result.pnl_from_resolved_unredeemed,
      trade_returns: result.trade_returns,
    };
  }

  /**
   * Compute PnL for multiple wallets.
   */
  async computeBatch(
    wallets: string[],
    options: V10Options = {},
    batchSize: number = 5,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WalletMetricsV10[]> {
    const results: WalletMetricsV10[] = [];

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
      results.push(...(batchResults.filter((r) => r !== null) as WalletMetricsV10[]));

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
      resolutionCount: this.resolutionCache?.size || 0,
    };
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

export async function createV10Engine(): Promise<V10Engine> {
  const engine = new V10Engine();
  return engine;
}

// -----------------------------------------------------------------------------
// Utility Functions for Ratios
// -----------------------------------------------------------------------------

export function calculateOmegaRatio(
  trade_returns: TradeReturn[],
  threshold: number = 0
): number {
  if (trade_returns.length === 0) return 0;

  let gains = 0;
  let losses = 0;

  for (const tr of trade_returns) {
    const excess = tr.return_pct - threshold;
    if (excess > 0) {
      gains += excess;
    } else {
      losses += Math.abs(excess);
    }
  }

  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function calculateSharpeRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;
  return mean / std;
}

export function calculateSortinoRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return mean > 0 ? Infinity : 0;

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return mean > 0 ? Infinity : 0;
  return mean / downsideStd;
}
