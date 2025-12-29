/**
 * ============================================================================
 * INVENTORY PNL ENGINE - V28 (CONDITION-LEVEL TRACKING)
 * ============================================================================
 *
 * V28 FIX: Track inventory at CONDITION level, not OUTCOME level.
 *
 * THE PROBLEM WITH V27b:
 * V27b tracked inventory per (conditionId, outcomeIndex).
 * But Polymarket CTF has a mismatch:
 * - CLOB buys happen on the TRADED outcome (e.g., idx=1 for YES tokens)
 * - PayoutRedemption happens on the WINNING outcome (e.g., idx=0 if YES wins)
 *
 * This caused V27b to see redemptions as pure profit since cost basis
 * was built on a different outcome_index than the redemption.
 *
 * THE FIX (V28):
 * Pool cost basis at the CONDITION level, not the outcome level.
 * When any outcome is sold/redeemed, use the pooled condition-level avgCost.
 *
 * ACCOUNTING RULES:
 * 1. BUY on any outcome:
 *    - totalQuantity += token_delta
 *    - totalCostBasis += |usdc_delta|
 *    - outcomeQuantities[outcome] += token_delta
 *
 * 2. SELL on any outcome:
 *    - tokensSold = |token_delta|
 *    - avgCost = totalCostBasis / totalQuantity (CONDITION-LEVEL)
 *    - CostOfGoodsSold = avgCost * tokensSold
 *    - Revenue = usdc_delta
 *    - realizedPnL += Revenue - CostOfGoodsSold
 *    - totalCostBasis -= CostOfGoodsSold
 *    - totalQuantity -= tokensSold
 *
 * 3. PayoutRedemption = Same as SELL (uses pooled cost basis)
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface V28Event {
  source_type: 'CLOB' | 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
  wallet_address: string;
  condition_id: string;
  outcome_index: number;
  event_time: Date;
  event_id: string;
  usdc_delta: number;
  token_delta: number;
  payout_norm: number | null;
}

/**
 * V28 tracks at the CONDITION level, not outcome level.
 * Cost basis is pooled across all outcomes.
 */
export interface V28ConditionPosition {
  conditionId: string;

  // ============================================
  // CONDITION-LEVEL TRACKING (the key change!)
  // ============================================
  totalQuantity: number;    // Sum of all tokens held across all outcomes
  totalCostBasis: number;   // Pooled cost basis across all outcomes
  realizedPnl: number;      // Accumulated realized PnL

  // ============================================
  // Per-outcome tracking (for diagnostics only)
  // ============================================
  outcomeQuantities: Map<number, number>;  // tokens per outcome
  outcomeCostBasis: Map<number, number>;   // cost per outcome (for diagnostics)

  // Diagnostic counters
  clobBuys: number;
  clobSells: number;
  splitEvents: number;
  mergeEvents: number;
  redemptionEvents: number;
}

export interface V28WalletState {
  wallet: string;
  positions: Map<string, V28ConditionPosition>; // key = conditionId (NOT conditionId|outcomeIndex!)
  eventsProcessed: number;
  errors: string[];
}

export interface V28Result {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionsCount: number;
  openPositions: number;
  closedPositions: number;
  eventsProcessed: number;
  errors: string[];
}

// ============================================================================
// V28 Inventory Engine - CONDITION-LEVEL TRACKING
// ============================================================================

export class InventoryEngineV28 {
  private state: Map<string, V28WalletState> = new Map();

  private getWalletState(wallet: string): V28WalletState {
    const key = wallet.toLowerCase();
    if (!this.state.has(key)) {
      this.state.set(key, {
        wallet: key,
        positions: new Map(),
        eventsProcessed: 0,
        errors: [],
      });
    }
    return this.state.get(key)!;
  }

  private getConditionPosition(
    walletState: V28WalletState,
    conditionId: string
  ): V28ConditionPosition {
    const key = conditionId.toLowerCase();
    if (!walletState.positions.has(key)) {
      walletState.positions.set(key, {
        conditionId: key,
        totalQuantity: 0,
        totalCostBasis: 0,
        realizedPnl: 0,
        outcomeQuantities: new Map(),
        outcomeCostBasis: new Map(),
        clobBuys: 0,
        clobSells: 0,
        splitEvents: 0,
        mergeEvents: 0,
        redemptionEvents: 0,
      });
    }
    return walletState.positions.get(key)!;
  }

  /**
   * Process a single event through the state machine
   *
   * V28 KEY DIFFERENCE: All inventory math uses CONDITION-LEVEL totals.
   * Cost basis from idx=1 will be used when redeeming on idx=0.
   */
  applyEvent(event: V28Event): void {
    const walletState = this.getWalletState(event.wallet_address);
    const position = this.getConditionPosition(walletState, event.condition_id);

    try {
      const tokenDelta = event.token_delta;
      const usdcDelta = event.usdc_delta;
      const outcomeIndex = event.outcome_index;

      // Get/initialize per-outcome quantities
      const currentOutcomeQty = position.outcomeQuantities.get(outcomeIndex) || 0;
      const currentOutcomeCost = position.outcomeCostBasis.get(outcomeIndex) || 0;

      if (tokenDelta > 0) {
        // ============================================================
        // BUY: Acquiring tokens
        // ============================================================
        // Increase CONDITION-LEVEL totals
        position.totalQuantity += tokenDelta;
        position.totalCostBasis += Math.abs(usdcDelta);

        // Track per-outcome for diagnostics
        position.outcomeQuantities.set(outcomeIndex, currentOutcomeQty + tokenDelta);
        position.outcomeCostBasis.set(outcomeIndex, currentOutcomeCost + Math.abs(usdcDelta));

        // Track source type
        if (event.source_type === 'CLOB') position.clobBuys++;
        else if (event.source_type === 'PositionSplit') position.splitEvents++;

      } else if (tokenDelta < 0) {
        // ============================================================
        // SELL: Disposing tokens (including redemption)
        // ============================================================
        const tokensSold = Math.abs(tokenDelta);

        // Calculate CONDITION-LEVEL average cost (THE KEY FIX!)
        const avgCost = position.totalQuantity > 0
          ? position.totalCostBasis / position.totalQuantity
          : 0;

        // Cost of goods sold (uses pooled cost basis)
        const cogs = avgCost * tokensSold;

        // Revenue is what we received
        const revenue = usdcDelta;

        // REALIZE PnL: Revenue - Cost
        position.realizedPnl += revenue - cogs;

        // Reduce CONDITION-LEVEL totals
        position.totalQuantity -= tokensSold;
        position.totalCostBasis = Math.max(0, position.totalCostBasis - cogs);

        // Track per-outcome for diagnostics
        position.outcomeQuantities.set(outcomeIndex, currentOutcomeQty - tokensSold);

        // Prevent negative quantities due to floating point
        if (position.totalQuantity < 0.0001) {
          position.totalQuantity = 0;
          position.totalCostBasis = 0;
        }

        // Track source type
        if (event.source_type === 'CLOB') position.clobSells++;
        else if (event.source_type === 'PositionsMerge') position.mergeEvents++;
        else if (event.source_type === 'PayoutRedemption') position.redemptionEvents++;

      } else if (tokenDelta === 0 && usdcDelta !== 0) {
        // ============================================================
        // PURE CASH EVENT (rare)
        // ============================================================
        // Some events may be pure cash without token movement
        // Treat positive cash as realized gain, negative as loss
        position.realizedPnl += usdcDelta;
      }

      walletState.eventsProcessed++;
    } catch (err: any) {
      walletState.errors.push(`Error processing ${event.event_id}: ${err.message}`);
    }
  }

  /**
   * Process a batch of events (MUST be sorted by event_time)
   */
  processEvents(events: V28Event[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Calculate unrealized PnL for open positions
   *
   * For positions with remaining quantity:
   *   unrealizedPnL = (markPrice - avgCost) * quantity
   */
  calculateUnrealizedPnl(
    wallet: string,
    priceOracle: Map<string, number> // key = conditionId -> resolution price (0 or 1)
  ): number {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return 0;

    let unrealizedPnl = 0;

    for (const [conditionId, position] of walletState.positions.entries()) {
      if (position.totalQuantity <= 0.0001) continue; // Position is closed

      // For resolved markets, use resolution price
      // For unresolved, use 0.5 as default
      const resolutionPrice = priceOracle.get(conditionId);
      const markPrice = resolutionPrice !== undefined ? resolutionPrice : 0.5;

      // Market value = tokens * price
      const marketValue = position.totalQuantity * markPrice;

      // Unrealized = market value - cost basis
      unrealizedPnl += marketValue - position.totalCostBasis;
    }

    return unrealizedPnl;
  }

  /**
   * Get full results for a wallet
   */
  getResult(wallet: string, priceOracle?: Map<string, number>): V28Result {
    const walletState = this.state.get(wallet.toLowerCase());

    if (!walletState) {
      return {
        wallet,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        positionsCount: 0,
        openPositions: 0,
        closedPositions: 0,
        eventsProcessed: 0,
        errors: [],
      };
    }

    // Sum realized PnL across all conditions
    let totalRealizedPnl = 0;
    let openPositions = 0;
    let closedPositions = 0;

    for (const position of walletState.positions.values()) {
      totalRealizedPnl += position.realizedPnl;

      if (position.totalQuantity > 0.0001) {
        openPositions++;
      } else {
        closedPositions++;
      }
    }

    const unrealizedPnl = priceOracle
      ? this.calculateUnrealizedPnl(wallet, priceOracle)
      : 0;

    return {
      wallet: walletState.wallet,
      realizedPnl: Math.round(totalRealizedPnl * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      totalPnl: Math.round((totalRealizedPnl + unrealizedPnl) * 100) / 100,
      positionsCount: walletState.positions.size,
      openPositions,
      closedPositions,
      eventsProcessed: walletState.eventsProcessed,
      errors: walletState.errors,
    };
  }

  /**
   * Get position details for debugging
   */
  getPositions(wallet: string): V28ConditionPosition[] {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return [];
    return Array.from(walletState.positions.values());
  }

  reset(): void {
    this.state.clear();
  }
}

// ============================================================================
// Data Loaders (same as V27b)
// ============================================================================

/**
 * Load ALL events from pm_unified_ledger_v7
 */
export async function loadV28Events(wallet: string): Promise<V28Event[]> {
  const query = `
    SELECT
      source_type,
      wallet_address,
      condition_id,
      outcome_index,
      event_time,
      event_id,
      usdc_delta,
      token_delta,
      payout_norm
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
    ORDER BY event_time ASC, event_id ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const events: V28Event[] = [];

  for (const r of rows) {
    events.push({
      source_type: r.source_type as V28Event['source_type'],
      wallet_address: r.wallet_address,
      condition_id: r.condition_id.toLowerCase(),
      outcome_index: Number(r.outcome_index),
      event_time: new Date(r.event_time),
      event_id: r.event_id,
      usdc_delta: Number(r.usdc_delta) || 0,
      token_delta: Number(r.token_delta) || 0,
      payout_norm: r.payout_norm !== null ? Number(r.payout_norm) : null,
    });
  }

  return events;
}

/**
 * Load resolution prices for marking open positions.
 * V28 uses CONDITION-LEVEL prices, not outcome-level.
 */
export async function loadV28ResolutionPrices(
  wallet: string
): Promise<Map<string, number>> {
  // Step 1: Get all unique condition_ids for this wallet
  const conditionsQuery = `
    SELECT DISTINCT
      lower(condition_id) as condition_id
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  const conditionsResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' });
  const conditions = (await conditionsResult.json()) as any[];

  if (conditions.length === 0) {
    return new Map();
  }

  // Batch conditions to avoid max query size errors (limit to 2000 per batch)
  const BATCH_SIZE = 2000;
  const prices = new Map<string, number>();

  for (let i = 0; i < conditions.length; i += BATCH_SIZE) {
    const batch = conditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map((c: any) => `'${c.condition_id}'`).join(',');

    // Step 2: Check if condition is resolved (any outcome has resolution price)
    // If resolved, we don't need unrealized PnL (all positions should be closed)
    const resolutionQuery = `
      SELECT
        lower(condition_id) as condition_id,
        max(resolved_price) as max_price
      FROM vw_pm_resolution_prices
      WHERE lower(condition_id) IN (${conditionList})
      GROUP BY condition_id
    `;

    try {
      const resResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
      const resRows = (await resResult.json()) as any[];

      for (const r of resRows) {
        if (!r.condition_id) continue;
        const key = r.condition_id.toLowerCase();
        const price = Number(r.max_price);
        if (!isNaN(price)) {
          // For resolved conditions, mark as resolved
          // The actual price doesn't matter much since positions should be closed
          prices.set(key, price);
        }
      }
    } catch (err) {
      // Continue with other batches if one fails
    }
  }

  return prices;
}

// ============================================================================
// Convenience Function
// ============================================================================

export async function calculateV28PnL(wallet: string): Promise<V28Result> {
  const engine = new InventoryEngineV28();

  // Load ALL events
  const events = await loadV28Events(wallet);
  engine.processEvents(events);

  // Load resolution prices for marking open positions
  const resolutionPrices = await loadV28ResolutionPrices(wallet);

  return engine.getResult(wallet, resolutionPrices);
}

// ============================================================================
// Quick Result (matches V23 interface)
// ============================================================================

export interface V28QuickResult {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  eventsProcessed: number;
}

export async function calculateV28Quick(wallet: string): Promise<V28QuickResult> {
  const result = await calculateV28PnL(wallet);
  return {
    realizedPnl: result.realizedPnl,
    unrealizedPnl: result.unrealizedPnl,
    totalPnl: result.totalPnl,
    eventsProcessed: result.eventsProcessed,
  };
}
