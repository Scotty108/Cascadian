/**
 * ============================================================================
 * SHADOW LEDGER PNL ENGINE - V23d [INVENTORY GUARD VARIANT]
 * ============================================================================
 *
 * STATUS: EXPERIMENTAL - Testing inventory guard on V23c
 * DATE: 2025-12-06
 * TERMINAL: Claude 1
 *
 * CHANGE FROM V23c:
 * - V23c: No inventory guard on sells (sells full amount regardless of tracked)
 * - V23d: Adds Polymarket-style inventory guard on SELLS ONLY
 *
 * THE SILVER BULLET INSIGHT (from polymarket/pnl-subgraph):
 * ```javascript
 * const adjustedAmount = amount.gt(userPosition.amount)
 *   ? userPosition.amount  // CLAMP to tracked
 *   : amount;
 * // "user obtained tokens outside of what we track"
 * ```
 *
 * GUARD RULES:
 * 1. Guard applies to SELLS ONLY (not buys)
 * 2. If selling more than tracked: clamp to tracked position
 * 3. Scale USDC proceeds proportionally (don't credit phantom revenue)
 * 4. Track clamped tokens for diagnostics
 *
 * FORMULA (same as V23c with guard):
 * - Resolved: PnL = cash_flow + (final_tokens * resolution_price)
 * - Unresolved: PnL = cash_flow + (final_tokens * outcome_price_from_metadata)
 */

import { clickhouse } from '../clickhouse/client';
import {
  ShadowLedgerResult,
  LedgerEvent,
  PositionState,
  WalletState,
  loadLedgerEventsForWallet,
} from './shadowLedgerV23';

// ============================================================================
// Types
// ============================================================================

export interface V23dOptions {
  useUIOracle?: boolean;      // true = use pm_market_metadata.outcome_prices
  inventoryGuard?: boolean;   // true = clamp sells to tracked inventory (DEFAULT: true)
  skipFallback?: boolean;     // true = only use V7 ledger, skip raw trades fallback (DEFAULT: false)
}

export interface V23dResult extends ShadowLedgerResult {
  uiOracleUsed: boolean;
  unresolvedConditions: number;
  uiPricesLoaded: number;
  lastPricesLoaded: number;
  // Inventory guard diagnostics
  inventoryGuardEnabled: boolean;
  clampedSellEvents: number;
  totalClampedTokens: number;
}

// ============================================================================
// V23d Engine with Inventory Guard
// ============================================================================

export class ShadowLedgerV23dEngine {
  private state: Map<string, WalletState> = new Map();

  // Diagnostic counters
  private clampedSellEvents = 0;
  private totalClampedTokens = 0;

  // Options
  private inventoryGuard: boolean;

  constructor(options: V23dOptions = {}) {
    this.inventoryGuard = options.inventoryGuard ?? true;
  }

  /**
   * Get or create wallet state
   */
  private getWalletState(wallet: string): WalletState {
    const key = wallet.toLowerCase();
    if (!this.state.has(key)) {
      this.state.set(key, {
        wallet: key,
        positions: new Map(),
        totalRealizedPnl: 0,
        eventsProcessed: 0,
        errors: [],
      });
    }
    return this.state.get(key)!;
  }

  /**
   * Get or create position state
   */
  private getPosition(
    walletState: WalletState,
    conditionId: string,
    outcomeIndex: number
  ): PositionState {
    const key = `${conditionId.toLowerCase()}|${outcomeIndex}`;
    if (!walletState.positions.has(key)) {
      walletState.positions.set(key, {
        conditionId: conditionId.toLowerCase(),
        outcomeIndex,
        quantity: 0,
        costBasis: 0,
        cashFlow: 0,
        realizedPnl: 0,
      });
    }
    return walletState.positions.get(key)!;
  }

  /**
   * Process a single event
   */
  applyEvent(event: LedgerEvent): void {
    const walletState = this.getWalletState(event.wallet_address);
    const position = this.getPosition(
      walletState,
      event.condition_id,
      event.outcome_index
    );

    try {
      switch (event.source_type) {
        case 'CLOB':
          this.applyClobEvent(position, event, walletState);
          break;
        case 'PositionSplit':
          this.applySplitEvent(position, event, walletState);
          break;
        case 'PositionsMerge':
          this.applyMergeEvent(position, event, walletState);
          break;
        case 'PayoutRedemption':
          this.applyRedemptionEvent(position, event, walletState);
          break;
        default:
          walletState.errors.push(`Unknown source_type: ${event.source_type}`);
      }
      walletState.eventsProcessed++;
    } catch (err: any) {
      walletState.errors.push(`Error processing event ${event.event_id}: ${err.message}`);
    }
  }

  /**
   * CLOB BUY/SELL with INVENTORY GUARD
   *
   * BUY (token_delta > 0):
   *   - No guard needed (always add full amount)
   *
   * SELL (token_delta < 0):
   *   - APPLY INVENTORY GUARD: clamp to tracked position
   *   - Scale USDC proceeds proportionally
   *   - Track clamped tokens for diagnostics
   */
  private applyClobEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    let tokenDelta = event.token_delta;
    let usdcDelta = event.usdc_delta;

    if (tokenDelta > 0) {
      // ============================================================
      // BUY: No guard needed, add full amount
      // ============================================================
      position.cashFlow += usdcDelta;
      position.quantity += tokenDelta;
      position.costBasis += Math.abs(usdcDelta);

    } else if (tokenDelta < 0) {
      // ============================================================
      // SELL: Apply inventory guard
      // ============================================================
      const tokensSold = Math.abs(tokenDelta);
      const trackedPosition = Math.max(0, position.quantity);

      // INVENTORY GUARD: Clamp to what we tracked buying
      let adjustedSold = tokensSold;
      let clampedTokens = 0;

      if (this.inventoryGuard && tokensSold > trackedPosition) {
        adjustedSold = trackedPosition;
        clampedTokens = tokensSold - adjustedSold;

        // Track diagnostics
        this.clampedSellEvents++;
        this.totalClampedTokens += clampedTokens;

        // Scale USDC proceeds proportionally
        // If we only "sold" half the tokens, we only recognize half the revenue
        if (tokensSold > 0) {
          const ratio = adjustedSold / tokensSold;
          usdcDelta = usdcDelta * ratio;
        }
      }

      // Apply adjusted amounts
      position.cashFlow += usdcDelta;
      position.quantity -= adjustedSold;

      // Update cost basis (for diagnostics)
      if (trackedPosition > 0) {
        const avgCost = position.costBasis / trackedPosition;
        position.costBasis = Math.max(0, position.costBasis - avgCost * adjustedSold);
      }
    }
  }

  /**
   * PositionSplit - Same as V23 (no guard on splits)
   */
  private applySplitEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    const tokenDelta = event.token_delta;
    const usdcDelta = event.usdc_delta;

    position.cashFlow += usdcDelta;

    if (tokenDelta > 0) {
      position.quantity += tokenDelta;
      position.costBasis += Math.abs(usdcDelta);
    } else if (tokenDelta < 0) {
      walletState.errors.push(`Unexpected negative token_delta in Split: ${event.event_id}`);
    }
  }

  /**
   * PositionsMerge - Apply inventory guard on token burns
   */
  private applyMergeEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    let tokenDelta = event.token_delta;
    let usdcDelta = event.usdc_delta;

    if (tokenDelta < 0) {
      const tokensBurned = Math.abs(tokenDelta);
      const trackedPosition = Math.max(0, position.quantity);

      // INVENTORY GUARD on merge burns
      let adjustedBurned = tokensBurned;
      if (this.inventoryGuard && tokensBurned > trackedPosition) {
        adjustedBurned = trackedPosition;
        const clampedTokens = tokensBurned - adjustedBurned;
        this.clampedSellEvents++;
        this.totalClampedTokens += clampedTokens;

        // Scale USDC proceeds proportionally
        if (tokensBurned > 0) {
          const ratio = adjustedBurned / tokensBurned;
          usdcDelta = usdcDelta * ratio;
        }
      }

      position.cashFlow += usdcDelta;

      if (trackedPosition > 0) {
        const avgCost = position.costBasis / trackedPosition;
        const costRemoved = avgCost * Math.min(adjustedBurned, trackedPosition);
        position.costBasis = Math.max(0, position.costBasis - costRemoved);
      }

      position.quantity -= adjustedBurned;
    } else if (tokenDelta > 0) {
      position.cashFlow += usdcDelta;
      position.quantity += tokenDelta;
    }
  }

  /**
   * PayoutRedemption - Apply inventory guard on redemptions
   */
  private applyRedemptionEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    let tokenDelta = event.token_delta;
    let usdcDelta = event.usdc_delta;

    if (tokenDelta < 0) {
      const tokensRedeemed = Math.abs(tokenDelta);
      const trackedPosition = Math.max(0, position.quantity);

      // INVENTORY GUARD on redemptions
      let adjustedRedeemed = tokensRedeemed;
      if (this.inventoryGuard && tokensRedeemed > trackedPosition) {
        adjustedRedeemed = trackedPosition;
        const clampedTokens = tokensRedeemed - adjustedRedeemed;
        this.clampedSellEvents++;
        this.totalClampedTokens += clampedTokens;

        // Scale USDC payout proportionally
        if (tokensRedeemed > 0) {
          const ratio = adjustedRedeemed / tokensRedeemed;
          usdcDelta = usdcDelta * ratio;
        }
      }

      position.cashFlow += usdcDelta;

      if (trackedPosition > 0) {
        const avgCost = position.costBasis / trackedPosition;
        const costRemoved = avgCost * Math.min(adjustedRedeemed, trackedPosition);
        position.costBasis = Math.max(0, position.costBasis - costRemoved);
      }

      position.quantity -= adjustedRedeemed;
    }
  }

  /**
   * Process a batch of events (MUST be sorted by event_time)
   */
  processEvents(events: LedgerEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Apply resolution prices to open positions
   */
  applyResolutions(
    wallet: string,
    resolutionPrices: Map<string, number>
  ): void {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return;

    for (const [key, position] of walletState.positions.entries()) {
      const resPrice = resolutionPrices.get(key);
      if (resPrice === undefined) continue;

      const pnl = position.cashFlow + (position.quantity * resPrice);
      position.realizedPnl = pnl;
      walletState.totalRealizedPnl += pnl;

      position.cashFlow = 0;
      position.quantity = 0;
      position.costBasis = 0;
    }
  }

  /**
   * Calculate unrealized PnL for remaining positions
   */
  calculateUnrealizedPnl(
    wallet: string,
    priceOracle?: (conditionId: string, outcomeIndex: number) => number
  ): number {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return 0;

    let unrealizedPnl = 0;

    for (const position of walletState.positions.values()) {
      if (Math.abs(position.cashFlow) > 0.01 || Math.abs(position.quantity) > 0.01) {
        const markPrice = priceOracle
          ? priceOracle(position.conditionId, position.outcomeIndex)
          : 0.5;

        unrealizedPnl += position.cashFlow + (position.quantity * markPrice);
      }
    }

    return unrealizedPnl;
  }

  /**
   * Get results for a specific wallet
   */
  getWalletResult(
    wallet: string,
    priceOracle?: (conditionId: string, outcomeIndex: number) => number
  ): ShadowLedgerResult {
    const walletState = this.state.get(wallet.toLowerCase());

    if (!walletState) {
      return {
        wallet,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        openPositions: 0,
        closedPositions: 0,
        eventsProcessed: 0,
        errors: [],
        clobPnl: 0,
        splitMergePnl: 0,
        redemptionPnl: 0,
      };
    }

    let openPositions = 0;
    let closedPositions = 0;

    for (const position of walletState.positions.values()) {
      if (Math.abs(position.quantity) > 0.01) {
        openPositions++;
      } else {
        closedPositions++;
      }
    }

    const unrealizedPnl = this.calculateUnrealizedPnl(wallet, priceOracle);

    return {
      wallet: walletState.wallet,
      realizedPnl: Math.round(walletState.totalRealizedPnl * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      totalPnl: Math.round((walletState.totalRealizedPnl + unrealizedPnl) * 100) / 100,
      openPositions,
      closedPositions,
      eventsProcessed: walletState.eventsProcessed,
      errors: walletState.errors,
      clobPnl: 0,
      splitMergePnl: 0,
      redemptionPnl: 0,
    };
  }

  /**
   * Get position details for debugging
   */
  getPositionDetails(wallet: string): PositionState[] {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return [];
    return Array.from(walletState.positions.values());
  }

  /**
   * Get inventory guard diagnostics
   */
  getGuardDiagnostics(): { clampedSellEvents: number; totalClampedTokens: number } {
    return {
      clampedSellEvents: this.clampedSellEvents,
      totalClampedTokens: this.totalClampedTokens,
    };
  }

  reset(): void {
    this.state.clear();
    this.clampedSellEvents = 0;
    this.totalClampedTokens = 0;
  }
}

// ============================================================================
// Data Loaders (reuse from V23c)
// ============================================================================

/**
 * Load trades directly from pm_trader_events_v2, bypassing stale unified ledger.
 *
 * CRITICAL: pm_trader_events_v2 contains duplicates from historical backfills (2-3x per wallet).
 * We MUST dedupe by event_id at the SQL layer using GROUP BY pattern.
 *
 * NOTE: ClickHouse doesn't allow aggregates in CTEs when WHERE references non-agg columns,
 * so we use a nested subquery pattern instead.
 */
async function loadRawTradesFallback(wallet: string): Promise<LedgerEvent[]> {
  const query = `
    WITH token_map AS (
      SELECT
        arrayJoin(token_ids) as token_id,
        condition_id,
        indexOf(token_ids, arrayJoin(token_ids)) - 1 as outcome_index
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    -- Dedupe pm_trader_events_v2 by event_id BEFORE joining
    -- Use nested subquery to avoid ClickHouse aggregate-in-CTE-with-WHERE issue
    trades_deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount,
        any(trade_time) as trade_time
      FROM (
        SELECT *
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
      )
      GROUP BY event_id
    )
    SELECT
      'CLOB' as source_type,
      t.trader_wallet as wallet_address,
      lower(tm.condition_id) as condition_id,
      toUInt8(tm.outcome_index) as outcome_index,
      t.trade_time as event_time,
      t.event_id as event_id,
      CASE
        WHEN lower(t.side) = 'buy' THEN -toFloat64(t.usdc_amount) / 1e6
        ELSE toFloat64(t.usdc_amount) / 1e6
      END as usdc_delta,
      CASE
        WHEN lower(t.side) = 'buy' THEN toFloat64(t.token_amount) / 1e6
        ELSE -toFloat64(t.token_amount) / 1e6
      END as token_delta,
      0 as payout_norm
    FROM trades_deduped t
    INNER JOIN token_map tm ON t.token_id = tm.token_id
    ORDER BY t.trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows
    .filter((row) => row.condition_id && typeof row.condition_id === 'string')
    .map((row) => ({
      source_type: row.source_type as LedgerEvent['source_type'],
      wallet_address: row.wallet_address,
      condition_id: row.condition_id,
      outcome_index: Number(row.outcome_index),
      event_time: new Date(row.event_time),
      event_id: row.event_id,
      usdc_delta: Number(row.usdc_delta),
      token_delta: Number(row.token_delta),
      payout_norm: Number(row.payout_norm),
    }));
}

/**
 * Load UI prices from pm_market_metadata.outcome_prices
 */
async function loadUIMarketPricesForRawTrades(wallet: string): Promise<Map<string, number>> {
  const query = `
    WITH token_map AS (
      SELECT
        arrayJoin(token_ids) as token_id,
        lower(condition_id) as condition_id,
        indexOf(token_ids, arrayJoin(token_ids)) - 1 as outcome_index,
        outcome_prices
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    traded_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT DISTINCT
      tm.condition_id,
      tm.outcome_index,
      tm.outcome_prices
    FROM token_map tm
    INNER JOIN traded_tokens tt ON tm.token_id = tt.token_id
    WHERE tm.outcome_prices IS NOT NULL
      AND tm.outcome_prices != ''
      AND tm.outcome_prices != '[]'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of rows) {
    if (!r.condition_id) continue;
    const conditionId = r.condition_id.toLowerCase();
    let priceStr = r.outcome_prices;

    try {
      if (priceStr && priceStr.startsWith('"') && priceStr.endsWith('"')) {
        priceStr = priceStr.slice(1, -1);
      }
      if (priceStr) priceStr = priceStr.replace(/\\"/g, '"');
      const priceArray = JSON.parse(priceStr || '[]');

      if (Array.isArray(priceArray)) {
        const outcomeIndex = Number(r.outcome_index);
        if (outcomeIndex >= 0 && outcomeIndex < priceArray.length) {
          const key = `${conditionId}|${outcomeIndex}`;
          const price = Number(priceArray[outcomeIndex]);
          if (!isNaN(price) && isFinite(price) && price >= 0 && price <= 1) {
            prices.set(key, price);
          }
        }
      }
    } catch {
      // Skip malformed price data
    }
  }

  return prices;
}

/**
 * Load resolution prices for conditions traded by raw events.
 */
async function loadResolutionPricesForRawTrades(wallet: string): Promise<Map<string, number>> {
  const query = `
    WITH token_map AS (
      SELECT
        arrayJoin(token_ids) as token_id,
        lower(condition_id) as condition_id
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    traded_conditions AS (
      SELECT DISTINCT tm.condition_id
      FROM pm_trader_events_v2 t
      INNER JOIN token_map tm ON t.token_id = tm.token_id
      WHERE lower(t.trader_wallet) = lower('${wallet}')
        AND t.is_deleted = 0
    )
    SELECT DISTINCT
      lower(r.condition_id) as condition_id,
      r.payout_numerators
    FROM pm_condition_resolutions r
    INNER JOIN traded_conditions tc ON lower(r.condition_id) = tc.condition_id
    WHERE r.is_deleted = 0
      AND r.payout_numerators IS NOT NULL
      AND r.payout_numerators != ''
      AND r.payout_numerators != '[]'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of rows) {
    if (!r.condition_id) continue;
    const conditionId = r.condition_id.toLowerCase();
    try {
      const payouts = JSON.parse(r.payout_numerators || '[]');
      if (Array.isArray(payouts)) {
        for (let i = 0; i < payouts.length; i++) {
          const key = `${conditionId}|${i}`;
          prices.set(key, Number(payouts[i]) || 0);
        }
      }
    } catch {
      // Skip malformed payout data
    }
  }

  return prices;
}

// ============================================================================
// Main V23d Calculator
// ============================================================================

/**
 * Calculate PnL using V23d (Inventory Guard) approach.
 *
 * Uses same data loading pattern as V23c:
 * 1. Primary: pm_unified_ledger_v7 (already deduplicated, CLOB-only)
 * 2. Fallback: pm_trader_events_v2 for events not in ledger
 */
export async function calculateV23dPnL(
  wallet: string,
  options: V23dOptions = { useUIOracle: true, inventoryGuard: true }
): Promise<V23dResult> {
  const engine = new ShadowLedgerV23dEngine({
    inventoryGuard: options.inventoryGuard ?? true,
  });

  // Load events from unified ledger V7 (primary, CLOB-only, deduplicated)
  const ledgerEvents = await loadLedgerEventsForWallet(wallet);

  let allEvents: LedgerEvent[];

  if (options.skipFallback) {
    // V23c-compatible mode: only use V7 ledger
    allEvents = ledgerEvents;
  } else {
    // Load raw trades fallback (direct from pm_trader_events_v2)
    const rawEvents = await loadRawTradesFallback(wallet);

    // Merge: Use raw events if ledger is empty or incomplete
    // Create a set of event IDs from ledger to dedupe
    const ledgerEventIds = new Set(ledgerEvents.map((e) => e.event_id));

    // Add raw events that aren't already in the ledger
    // ALSO dedupe raw events by event_id (metadata join can create duplicates)
    const seenRawEventIds = new Set<string>();
    const fallbackEvents = rawEvents.filter((e) => {
      if (ledgerEventIds.has(e.event_id)) return false;  // Already in ledger
      if (seenRawEventIds.has(e.event_id)) return false; // Already seen in raw
      seenRawEventIds.add(e.event_id);
      return true;
    });

    // Combine all events
    allEvents = [...ledgerEvents, ...fallbackEvents];
  }

  engine.processEvents(allEvents);

  // Load resolution prices
  const resolutionPrices = await loadResolutionPricesForRawTrades(wallet);

  // Load UI prices (if enabled)
  let uiPrices = new Map<string, number>();
  if (options.useUIOracle) {
    uiPrices = await loadUIMarketPricesForRawTrades(wallet);
  }

  // Create price oracle with priority: resolution > UI > 0.50
  const priceOracle = (conditionId: string, outcomeIndex: number): number => {
    if (!conditionId) return 0.5;
    const key = `${conditionId.toLowerCase()}|${outcomeIndex}`;

    const resPrice = resolutionPrices.get(key);
    if (resPrice !== undefined) return resPrice;

    if (options.useUIOracle) {
      const uiPrice = uiPrices.get(key);
      if (uiPrice !== undefined) return uiPrice;
    }

    return 0.5;
  };

  // Apply resolutions
  engine.applyResolutions(wallet, resolutionPrices);

  // Get base result
  const baseResult = engine.getWalletResult(wallet, priceOracle);

  // Count unresolved conditions
  const positions = engine.getPositionDetails(wallet);
  let unresolvedConditions = 0;
  for (const pos of positions) {
    if (!pos.conditionId) continue;
    const key = `${pos.conditionId.toLowerCase()}|${pos.outcomeIndex}`;
    if (!resolutionPrices.has(key) && Math.abs(pos.quantity) > 0.01) {
      unresolvedConditions++;
    }
  }

  const guardDiagnostics = engine.getGuardDiagnostics();

  return {
    ...baseResult,
    uiOracleUsed: options.useUIOracle ?? true,
    unresolvedConditions,
    uiPricesLoaded: uiPrices.size,
    lastPricesLoaded: 0,
    inventoryGuardEnabled: options.inventoryGuard ?? true,
    clampedSellEvents: guardDiagnostics.clampedSellEvents,
    totalClampedTokens: guardDiagnostics.totalClampedTokens,
  };
}

// ============================================================================
// Convenience Exports
// ============================================================================

export async function calculateV23dWithGuard(wallet: string): Promise<V23dResult> {
  return calculateV23dPnL(wallet, { useUIOracle: true, inventoryGuard: true });
}

export async function calculateV23dWithoutGuard(wallet: string): Promise<V23dResult> {
  return calculateV23dPnL(wallet, { useUIOracle: true, inventoryGuard: false });
}
