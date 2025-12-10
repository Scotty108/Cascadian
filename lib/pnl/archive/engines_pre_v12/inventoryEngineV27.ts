/**
 * ============================================================================
 * INVENTORY PNL ENGINE - V27 (STATE MACHINE)
 * ============================================================================
 *
 * PURPOSE: Achieve accurate PnL for ALL wallet types by properly tracking
 *          inventory, cost basis, and realized PnL through all event types.
 *
 * THE DIAGNOSIS (from Pure Trader Filter Test):
 * 1. V23 CLOB-only fails for some pure traders with >90% error
 * 2. These wallets have significant PnL from PayoutRedemption events
 *    where CLOB activity was minimal
 * 3. V26 ALL-sources fails because it doesn't track cost basis properly
 *
 * THE SOLUTION (V27):
 * Process ALL events chronologically as a state machine:
 * - Track position quantity, cost basis, and cash flow per (condition, outcome)
 * - Apply V20 formula at resolution: PnL = cash_flow + (tokens * resolved_price)
 *
 * ACCOUNTING RULES BY SOURCE TYPE:
 * 1. CLOB BUY: qty += tokens, costBasis += |usdc|, cashFlow += usdc (negative)
 * 2. CLOB SELL: qty -= tokens, costBasis reduced proportionally, cashFlow += usdc (positive)
 * 3. PositionSplit: Lock USDC to mint tokens at $0.50 each side
 *    - qty += tokens, costBasis += |usdc|, cashFlow += usdc (negative)
 * 4. PositionsMerge: Burn tokens to unlock USDC
 *    - qty -= tokens, costBasis reduced, cashFlow += usdc (positive)
 * 5. PayoutRedemption: Final settlement
 *    - qty = 0, PnL = cash_flow + tokens * resolution_price
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface V27Event {
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

export interface V27Position {
  conditionId: string;
  outcomeIndex: number;
  quantity: number;      // Current token balance
  costBasis: number;     // Total USDC spent to acquire
  cashFlow: number;      // Net USDC in/out (V20 formula input)
  realizedPnl: number;   // Computed at resolution
  isResolved: boolean;   // Whether resolution has been applied

  // Diagnostic tracking
  clobEvents: number;
  splitEvents: number;
  mergeEvents: number;
  redemptionEvents: number;
}

export interface V27WalletState {
  wallet: string;
  positions: Map<string, V27Position>; // key = conditionId|outcomeIndex
  totalRealizedPnl: number;
  eventsProcessed: number;
  errors: string[];
}

export interface V27Result {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  marketsTraded: number;
  resolvedMarkets: number;
  unresolvedMarkets: number;
  eventsProcessed: number;

  // Source breakdown
  clobCashFlow: number;
  splitCashFlow: number;
  mergeCashFlow: number;
  redemptionCashFlow: number;

  errors: string[];
}

// ============================================================================
// Position Key Helper
// ============================================================================

function makeKey(conditionId: string, outcomeIndex: number): string {
  return `${conditionId.toLowerCase()}|${outcomeIndex}`;
}

// ============================================================================
// V27 Inventory Engine
// ============================================================================

export class InventoryEngineV27 {
  private state: Map<string, V27WalletState> = new Map();

  // Diagnostic counters
  private clobCashFlow = 0;
  private splitCashFlow = 0;
  private mergeCashFlow = 0;
  private redemptionCashFlow = 0;

  private getWalletState(wallet: string): V27WalletState {
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

  private getPosition(
    walletState: V27WalletState,
    conditionId: string,
    outcomeIndex: number
  ): V27Position {
    const key = makeKey(conditionId, outcomeIndex);
    if (!walletState.positions.has(key)) {
      walletState.positions.set(key, {
        conditionId: conditionId.toLowerCase(),
        outcomeIndex,
        quantity: 0,
        costBasis: 0,
        cashFlow: 0,
        realizedPnl: 0,
        isResolved: false,
        clobEvents: 0,
        splitEvents: 0,
        mergeEvents: 0,
        redemptionEvents: 0,
      });
    }
    return walletState.positions.get(key)!;
  }

  /**
   * Process a single event through the state machine
   */
  applyEvent(event: V27Event): void {
    const walletState = this.getWalletState(event.wallet_address);
    const position = this.getPosition(
      walletState,
      event.condition_id,
      event.outcome_index
    );

    try {
      // All source types follow the same core accounting:
      // 1. Update token quantity
      // 2. Update cost basis
      // 3. Track cash flow (for V20 formula)

      const tokenDelta = event.token_delta;
      const usdcDelta = event.usdc_delta;

      // Track cash flow (V20 formula input)
      position.cashFlow += usdcDelta;

      // Update token quantity
      position.quantity += tokenDelta;

      // Update cost basis
      if (tokenDelta > 0) {
        // Acquiring tokens: add to cost basis
        position.costBasis += Math.abs(usdcDelta);
      } else if (tokenDelta < 0 && position.quantity > 0) {
        // Disposing tokens: reduce cost basis proportionally
        const prevQty = position.quantity - tokenDelta; // qty before this event
        if (prevQty > 0) {
          const avgCost = position.costBasis / prevQty;
          const costRemoved = avgCost * Math.abs(tokenDelta);
          position.costBasis = Math.max(0, position.costBasis - costRemoved);
        }
      }

      // Track source-specific diagnostics
      switch (event.source_type) {
        case 'CLOB':
          position.clobEvents++;
          this.clobCashFlow += usdcDelta;
          break;
        case 'PositionSplit':
          position.splitEvents++;
          this.splitCashFlow += usdcDelta;
          break;
        case 'PositionsMerge':
          position.mergeEvents++;
          this.mergeCashFlow += usdcDelta;
          break;
        case 'PayoutRedemption':
          position.redemptionEvents++;
          this.redemptionCashFlow += usdcDelta;
          break;
      }

      walletState.eventsProcessed++;
    } catch (err: any) {
      walletState.errors.push(`Error processing ${event.event_id}: ${err.message}`);
    }
  }

  /**
   * Process a batch of events (MUST be sorted by event_time)
   */
  processEvents(events: V27Event[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Apply resolution prices to compute realized PnL
   *
   * V20 FORMULA (CANONICAL):
   *   realized_pnl = cash_flow + (final_tokens * resolution_price)
   */
  applyResolutions(
    wallet: string,
    resolutionPrices: Map<string, number> // key = conditionId|outcomeIndex -> price
  ): void {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return;

    for (const [key, position] of walletState.positions.entries()) {
      if (position.isResolved) continue; // Already resolved

      const resPrice = resolutionPrices.get(key);
      if (resPrice === undefined) continue; // Not resolved yet

      // V20 FORMULA: PnL = cash_flow + (tokens * resolution_price)
      const pnl = position.cashFlow + (position.quantity * resPrice);

      position.realizedPnl = pnl;
      position.isResolved = true;
      walletState.totalRealizedPnl += pnl;
    }
  }

  /**
   * Calculate unrealized PnL for open positions
   * Uses 0.5 as default mark price for unresolved positions
   */
  calculateUnrealizedPnl(
    wallet: string,
    priceOracle?: (conditionId: string, outcomeIndex: number) => number
  ): number {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return 0;

    let unrealizedPnl = 0;

    for (const position of walletState.positions.values()) {
      if (position.isResolved) continue;

      if (Math.abs(position.quantity) > 0.01 || Math.abs(position.cashFlow) > 0.01) {
        const markPrice = priceOracle
          ? priceOracle(position.conditionId, position.outcomeIndex)
          : 0.5;

        // V20 FORMULA at mark: PnL = cash_flow + (tokens * mark_price)
        unrealizedPnl += position.cashFlow + (position.quantity * markPrice);
      }
    }

    return unrealizedPnl;
  }

  /**
   * Get full results for a wallet
   */
  getResult(wallet: string): V27Result {
    const walletState = this.state.get(wallet.toLowerCase());

    if (!walletState) {
      return {
        wallet,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        marketsTraded: 0,
        resolvedMarkets: 0,
        unresolvedMarkets: 0,
        eventsProcessed: 0,
        clobCashFlow: 0,
        splitCashFlow: 0,
        mergeCashFlow: 0,
        redemptionCashFlow: 0,
        errors: [],
      };
    }

    // Count markets
    const marketsSeen = new Set<string>();
    const resolvedMarkets = new Set<string>();

    for (const position of walletState.positions.values()) {
      marketsSeen.add(position.conditionId);
      if (position.isResolved) {
        resolvedMarkets.add(position.conditionId);
      }
    }

    const unrealizedPnl = this.calculateUnrealizedPnl(wallet);

    return {
      wallet: walletState.wallet,
      realizedPnl: Math.round(walletState.totalRealizedPnl * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      totalPnl: Math.round((walletState.totalRealizedPnl + unrealizedPnl) * 100) / 100,
      marketsTraded: marketsSeen.size,
      resolvedMarkets: resolvedMarkets.size,
      unresolvedMarkets: marketsSeen.size - resolvedMarkets.size,
      eventsProcessed: walletState.eventsProcessed,
      clobCashFlow: Math.round(this.clobCashFlow * 100) / 100,
      splitCashFlow: Math.round(this.splitCashFlow * 100) / 100,
      mergeCashFlow: Math.round(this.mergeCashFlow * 100) / 100,
      redemptionCashFlow: Math.round(this.redemptionCashFlow * 100) / 100,
      errors: walletState.errors,
    };
  }

  /**
   * Get position details for debugging
   */
  getPositions(wallet: string): V27Position[] {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return [];
    return Array.from(walletState.positions.values());
  }

  reset(): void {
    this.state.clear();
    this.clobCashFlow = 0;
    this.splitCashFlow = 0;
    this.mergeCashFlow = 0;
    this.redemptionCashFlow = 0;
  }
}

// ============================================================================
// Data Loaders
// ============================================================================

/**
 * Load ALL events from pm_unified_ledger_v7 (not CLOB-only like V23)
 */
export async function loadV27Events(wallet: string): Promise<V27Event[]> {
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

  const events: V27Event[] = [];

  for (const r of rows) {
    events.push({
      source_type: r.source_type as V27Event['source_type'],
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
 * Load resolution prices from vw_pm_resolution_prices with payout_norm fallback
 *
 * FIXED: Simplified query - the complex CTE was returning empty results.
 * Now uses direct subquery join which works correctly.
 */
export async function loadV27ResolutionPrices(
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

  // Step 2: Get resolution prices for all conditions at once
  const conditionList = conditions.map((c) => `'${c.condition_id}'`).join(',');
  const resolutionQuery = `
    SELECT
      lower(condition_id) as condition_id,
      outcome_index,
      resolved_price
    FROM vw_pm_resolution_prices
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const resResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const prices = new Map<string, number>();
  for (const r of resRows) {
    if (!r.condition_id) continue;
    const key = makeKey(r.condition_id, Number(r.outcome_index));
    const price = Number(r.resolved_price);
    if (!isNaN(price)) {
      prices.set(key, price);
    }
  }

  // Step 3: Fallback to payout_norm from PayoutRedemption events for missing prices
  const missingConditions = conditions.filter((c) => {
    const key = makeKey(c.condition_id, Number(c.outcome_index));
    return !prices.has(key);
  });

  if (missingConditions.length > 0) {
    const missingList = missingConditions.map((c) => `'${c.condition_id}'`).join(',');
    // Use subquery to filter first, then aggregate - avoids alias conflict
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
  }

  return prices;
}

// ============================================================================
// Convenience Function
// ============================================================================

export async function calculateV27PnL(wallet: string): Promise<V27Result> {
  const engine = new InventoryEngineV27();

  // Load ALL events (not just CLOB)
  const events = await loadV27Events(wallet);
  engine.processEvents(events);

  // Load resolution prices and apply
  const resolutionPrices = await loadV27ResolutionPrices(wallet);
  engine.applyResolutions(wallet, resolutionPrices);

  return engine.getResult(wallet);
}

// ============================================================================
// Quick Result (matches V23 interface)
// ============================================================================

export interface V27QuickResult {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  eventsProcessed: number;
}

export async function calculateV27Quick(wallet: string): Promise<V27QuickResult> {
  const result = await calculateV27PnL(wallet);
  return {
    realizedPnl: result.realizedPnl,
    unrealizedPnl: result.unrealizedPnl,
    totalPnl: result.totalPnl,
    eventsProcessed: result.eventsProcessed,
  };
}
