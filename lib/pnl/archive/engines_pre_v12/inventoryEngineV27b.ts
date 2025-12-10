/**
 * ============================================================================
 * INVENTORY PNL ENGINE - V27b (PURE INVENTORY MATH)
 * ============================================================================
 *
 * V27b FIX: Abandon "Ledger Math" completely.
 *
 * THE PROBLEM WITH V27:
 * V27 mixed two math models:
 * 1. Ledger Math: Sum(USDC)
 * 2. Inventory Math: Quantity * Price
 *
 * When a redemption happens, it counted the Cash (Model 1) AND valued
 * tokens at resolution price (Model 2). This caused 1000% errors.
 *
 * THE FIX (V27b):
 * PnL must be derived PURELY from the State Machine:
 * - Each trade: realizedPnL += Revenue - CostOfGoodsSold
 * - NO global usdc_delta sums
 * - PayoutRedemption treated as Final Sell
 *
 * ACCOUNTING RULES:
 * 1. BUY (token_delta > 0):
 *    - quantity += token_delta
 *    - costBasis += |usdc_delta|  (what we paid)
 *    - avgCost = costBasis / quantity
 *
 * 2. SELL (token_delta < 0):
 *    - tokensSold = |token_delta|
 *    - CostOfGoodsSold = avgCost * tokensSold
 *    - Revenue = usdc_delta (what we received)
 *    - realizedPnL += Revenue - CostOfGoodsSold
 *    - costBasis -= CostOfGoodsSold
 *    - quantity -= tokensSold
 *
 * 3. PayoutRedemption (FINAL SELL):
 *    - Same as SELL but tokens are redeemed at resolution price
 *    - Revenue = usdc_delta (payout received)
 *    - CostOfGoodsSold = avgCost * tokensRedeemed
 *    - realizedPnL += Revenue - CostOfGoodsSold
 *    - Tokens zeroed out
 *
 * 4. End-of-Stream Valuation:
 *    - For open positions: unrealizedPnL = (markPrice - avgCost) * quantity
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface V27bEvent {
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

export interface V27bPosition {
  conditionId: string;
  outcomeIndex: number;
  quantity: number;      // Current token balance
  costBasis: number;     // Total cost of current holdings
  realizedPnl: number;   // Accumulated realized PnL from sells

  // Diagnostic tracking
  clobBuys: number;
  clobSells: number;
  splitEvents: number;
  mergeEvents: number;
  redemptionEvents: number;
}

export interface V27bWalletState {
  wallet: string;
  positions: Map<string, V27bPosition>; // key = conditionId|outcomeIndex
  eventsProcessed: number;
  errors: string[];
}

export interface V27bResult {
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
// Position Key Helper
// ============================================================================

function makeKey(conditionId: string, outcomeIndex: number): string {
  return `${conditionId.toLowerCase()}|${outcomeIndex}`;
}

// ============================================================================
// V27b Inventory Engine - PURE INVENTORY MATH
// ============================================================================

export class InventoryEngineV27b {
  private state: Map<string, V27bWalletState> = new Map();

  private getWalletState(wallet: string): V27bWalletState {
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

  private getPosition(
    walletState: V27bWalletState,
    conditionId: string,
    outcomeIndex: number
  ): V27bPosition {
    const key = makeKey(conditionId, outcomeIndex);
    if (!walletState.positions.has(key)) {
      walletState.positions.set(key, {
        conditionId: conditionId.toLowerCase(),
        outcomeIndex,
        quantity: 0,
        costBasis: 0,
        realizedPnl: 0,
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
   * PURE INVENTORY MATH:
   * - BUY: Add to inventory, increase cost basis
   * - SELL: Remove from inventory, realize PnL = Revenue - COGS
   */
  applyEvent(event: V27bEvent): void {
    const walletState = this.getWalletState(event.wallet_address);
    const position = this.getPosition(
      walletState,
      event.condition_id,
      event.outcome_index
    );

    try {
      const tokenDelta = event.token_delta;
      const usdcDelta = event.usdc_delta;

      if (tokenDelta > 0) {
        // ============================================================
        // BUY: Acquiring tokens
        // ============================================================
        // Increase inventory
        position.quantity += tokenDelta;
        // Increase cost basis by what we paid (usdc_delta is negative for buys)
        position.costBasis += Math.abs(usdcDelta);

        // Track source type
        if (event.source_type === 'CLOB') position.clobBuys++;
        else if (event.source_type === 'PositionSplit') position.splitEvents++;

      } else if (tokenDelta < 0) {
        // ============================================================
        // SELL: Disposing tokens (including redemption)
        // ============================================================
        const tokensSold = Math.abs(tokenDelta);

        // Calculate average cost per token
        const avgCost = position.quantity > 0
          ? position.costBasis / position.quantity
          : 0;

        // Cost of goods sold
        const cogs = avgCost * tokensSold;

        // Revenue is what we received (usdc_delta is positive for sells)
        const revenue = usdcDelta;

        // REALIZE PnL: Revenue - Cost
        position.realizedPnl += revenue - cogs;

        // Reduce inventory
        position.quantity -= tokensSold;

        // Reduce cost basis proportionally
        position.costBasis = Math.max(0, position.costBasis - cogs);

        // Prevent negative quantities due to floating point
        if (position.quantity < 0.0001) {
          position.quantity = 0;
          position.costBasis = 0;
        }

        // Track source type
        if (event.source_type === 'CLOB') position.clobSells++;
        else if (event.source_type === 'PositionsMerge') position.mergeEvents++;
        else if (event.source_type === 'PayoutRedemption') position.redemptionEvents++;

      } else if (tokenDelta === 0 && usdcDelta !== 0) {
        // ============================================================
        // PURE CASH EVENT (rare, but handle it)
        // ============================================================
        // Some events may be pure cash without token movement
        // For example, fee adjustments or corrections
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
  processEvents(events: V27bEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Calculate unrealized PnL for open positions
   *
   * For positions with remaining quantity:
   *   unrealizedPnL = (markPrice - avgCost) * quantity
   *
   * Or equivalently:
   *   unrealizedPnL = (markPrice * quantity) - costBasis
   */
  calculateUnrealizedPnl(
    wallet: string,
    priceOracle: Map<string, number> // key = conditionId|outcomeIndex -> price
  ): number {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return 0;

    let unrealizedPnl = 0;

    for (const [key, position] of walletState.positions.entries()) {
      if (position.quantity <= 0.0001) continue; // Position is closed

      const markPrice = priceOracle.get(key);
      if (markPrice === undefined) {
        // For unresolved markets without price, use 0.5 as default
        const defaultMark = 0.5;
        const marketValue = position.quantity * defaultMark;
        unrealizedPnl += marketValue - position.costBasis;
      } else {
        // Use resolution price or market price
        const marketValue = position.quantity * markPrice;
        unrealizedPnl += marketValue - position.costBasis;
      }
    }

    return unrealizedPnl;
  }

  /**
   * Get full results for a wallet
   */
  getResult(wallet: string, priceOracle?: Map<string, number>): V27bResult {
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

    // Sum realized PnL across all positions
    let totalRealizedPnl = 0;
    let openPositions = 0;
    let closedPositions = 0;

    for (const position of walletState.positions.values()) {
      totalRealizedPnl += position.realizedPnl;

      if (position.quantity > 0.0001) {
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
  getPositions(wallet: string): V27bPosition[] {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return [];
    return Array.from(walletState.positions.values());
  }

  reset(): void {
    this.state.clear();
  }
}

// ============================================================================
// Data Loaders
// ============================================================================

/**
 * Load ALL events from pm_unified_ledger_v7
 */
export async function loadV27bEvents(wallet: string): Promise<V27bEvent[]> {
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

  const events: V27bEvent[] = [];

  for (const r of rows) {
    events.push({
      source_type: r.source_type as V27bEvent['source_type'],
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
 * Load resolution prices for marking open positions
 */
export async function loadV27bResolutionPrices(
  wallet: string
): Promise<Map<string, number>> {
  // Step 1: Get all unique (condition_id, outcome_index) pairs for this wallet
  const conditionsQuery = `
    SELECT DISTINCT
      lower(condition_id) as condition_id,
      outcome_index
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

    // Step 2: Get resolution prices for this batch
    const resolutionQuery = `
      SELECT
        lower(condition_id) as condition_id,
        outcome_index,
        resolved_price
      FROM vw_pm_resolution_prices
      WHERE lower(condition_id) IN (${conditionList})
    `;

    try {
      const resResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
      const resRows = (await resResult.json()) as any[];

      for (const r of resRows) {
        if (!r.condition_id) continue;
        const key = makeKey(r.condition_id, Number(r.outcome_index));
        const price = Number(r.resolved_price);
        if (!isNaN(price)) {
          prices.set(key, price);
        }
      }
    } catch (err) {
      // Continue with other batches if one fails
    }
  }

  // Step 3: Fallback to payout_norm from PayoutRedemption for missing prices
  const missingConditions = conditions.filter((c: any) => {
    const key = makeKey(c.condition_id, Number(c.outcome_index));
    return !prices.has(key);
  });

  if (missingConditions.length > 0 && missingConditions.length <= BATCH_SIZE) {
    const missingList = missingConditions.map((c: any) => `'${c.condition_id}'`).join(',');
    const payoutQuery = `
      SELECT
        lower(condition_id) as cond_id,
        outcome_index,
        any(payout_norm) as payout_val
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'PayoutRedemption'
        AND lower(condition_id) IN (${missingList})
        AND payout_norm IS NOT NULL
        AND payout_norm >= 0
      GROUP BY condition_id, outcome_index
    `;

    try {
      const payoutResult = await clickhouse.query({ query: payoutQuery, format: 'JSONEachRow' });
      const payoutRows = (await payoutResult.json()) as any[];

      for (const r of payoutRows) {
        if (!r.cond_id) continue;
        const key = makeKey(r.cond_id, Number(r.outcome_index));
        if (!prices.has(key)) {
          const payout = Number(r.payout_val);
          if (!isNaN(payout)) {
            prices.set(key, payout);
          }
        }
      }
    } catch (err) {
      // Silently continue if fallback fails
    }
  }

  return prices;
}

// ============================================================================
// Convenience Function
// ============================================================================

export async function calculateV27bPnL(wallet: string): Promise<V27bResult> {
  const engine = new InventoryEngineV27b();

  // Load ALL events
  const events = await loadV27bEvents(wallet);
  engine.processEvents(events);

  // Load resolution prices for marking open positions
  const resolutionPrices = await loadV27bResolutionPrices(wallet);

  return engine.getResult(wallet, resolutionPrices);
}

// ============================================================================
// Quick Result (matches V23 interface)
// ============================================================================

export interface V27bQuickResult {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  eventsProcessed: number;
}

export async function calculateV27bQuick(wallet: string): Promise<V27bQuickResult> {
  const result = await calculateV27bPnL(wallet);
  return {
    realizedPnl: result.realizedPnl,
    unrealizedPnl: result.unrealizedPnl,
    totalPnl: result.totalPnl,
    eventsProcessed: result.eventsProcessed,
  };
}
