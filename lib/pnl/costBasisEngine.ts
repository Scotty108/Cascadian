/**
 * Cost Basis Engine V1
 *
 * A proper accounting-based approach to PnL calculation.
 *
 * Key insight: PnL is not a formula over aggregated data - it's an accounting identity.
 * We maintain per-wallet, per-position state and process events sequentially.
 *
 * Balance Sheet Approach:
 *   PnL = [Net worth at end] - [Net worth at start] - [Net deposits]
 *
 * For Polymarket:
 *   PnL = Realized PnL + Unrealized PnL
 *   Realized PnL = cumulative gains/losses from closed positions
 *   Unrealized PnL = (current_price - avg_cost) * qty_tokens for open positions
 *
 * Event Types:
 *   - CLOB BUY: Acquire tokens by spending USDC (add to position, add to cost basis)
 *   - CLOB SELL: Dispose of tokens for USDC (realize PnL, reduce position)
 *   - PositionSplit: Set tokens → Leg tokens (internal conversion, no PnL)
 *   - PositionsMerge: Leg tokens → Set tokens OR USDC (PnL only if legs → USDC)
 *   - PayoutRedemption: Settlement at resolution price (realize PnL)
 */

// ============================================================================
// Types
// ============================================================================

export interface LedgerEvent {
  wallet_address: string;
  canonical_condition_id: string;
  outcome_index: number;
  source_type: 'CLOB' | 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
  event_time: Date;
  event_id: string;
  usdc_delta: number;  // positive = receiving USDC, negative = spending USDC
  token_delta: number; // positive = receiving tokens, negative = losing tokens
  payout_norm: number | null;  // resolution price (0 or 1 for binary)
}

export type PositionKey = string; // wallet + condition + outcome

export interface PositionState {
  qtyTokens: number;         // current token balance (can be negative for shorts)
  costBasisTotal: number;    // total USDC spent to acquire this position
  realizedPnl: number;       // cumulative realized PnL from sells/redemptions
}

export interface WalletState {
  positions: Map<PositionKey, PositionState>;
  totalRealizedPnl: number;
}

export interface EngineResult {
  wallet: string;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalPnl: number;
  openPositions: number;
  closedPositions: number;
  eventsProcessed: number;
  errors: string[];
}

// ============================================================================
// Position Key Helper
// ============================================================================

export function makePositionKey(
  wallet: string,
  conditionId: string,
  outcomeIndex: number
): PositionKey {
  return `${wallet.toLowerCase()}|${conditionId.toLowerCase()}|${outcomeIndex}`;
}

export function parsePositionKey(key: PositionKey): {
  wallet: string;
  conditionId: string;
  outcomeIndex: number;
} {
  const [wallet, conditionId, outcomeIdx] = key.split('|');
  return { wallet, conditionId, outcomeIndex: parseInt(outcomeIdx, 10) };
}

// ============================================================================
// Cost Basis Engine
// ============================================================================

export class CostBasisEngine {
  private state: Map<string, WalletState> = new Map(); // wallet -> WalletState
  private eventsProcessed = 0;
  private errors: string[] = [];

  /**
   * Get or create wallet state
   */
  private getWalletState(wallet: string): WalletState {
    const key = wallet.toLowerCase();
    if (!this.state.has(key)) {
      this.state.set(key, {
        positions: new Map(),
        totalRealizedPnl: 0,
      });
    }
    return this.state.get(key)!;
  }

  /**
   * Get or create position state
   */
  private getPosition(walletState: WalletState, positionKey: PositionKey): PositionState {
    if (!walletState.positions.has(positionKey)) {
      walletState.positions.set(positionKey, {
        qtyTokens: 0,
        costBasisTotal: 0,
        realizedPnl: 0,
      });
    }
    return walletState.positions.get(positionKey)!;
  }

  /**
   * Process a single event
   */
  applyEvent(event: LedgerEvent): void {
    const walletState = this.getWalletState(event.wallet_address);
    const posKey = makePositionKey(
      event.wallet_address,
      event.canonical_condition_id,
      event.outcome_index
    );
    const position = this.getPosition(walletState, posKey);

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
          this.errors.push(`Unknown source_type: ${event.source_type}`);
      }
      this.eventsProcessed++;
    } catch (err: any) {
      this.errors.push(`Error processing event ${event.event_id}: ${err.message}`);
    }
  }

  /**
   * CLOB BUY/SELL
   *
   * BUY (token_delta > 0, usdc_delta < 0):
   *   - qty_tokens += fill_size
   *   - cost_basis += |usdc_spent|
   *   - no PnL
   *
   * SELL (token_delta < 0, usdc_delta > 0):
   *   - avg_cost = cost_basis / qty_before (if qty_before > 0)
   *   - cost_removed = avg_cost * qty_sold
   *   - realized_pnl += usdc_received - cost_removed
   *   - qty_tokens -= qty_sold
   *   - cost_basis -= cost_removed
   */
  private applyClobEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    const tokenDelta = event.token_delta;
    const usdcDelta = event.usdc_delta;

    if (tokenDelta > 0) {
      // BUY: acquiring tokens
      const usdcSpent = Math.abs(usdcDelta); // usdc_delta is negative for buys
      position.qtyTokens += tokenDelta;
      position.costBasisTotal += usdcSpent;
    } else if (tokenDelta < 0) {
      // SELL: disposing tokens
      const qtySold = Math.abs(tokenDelta);
      const usdcReceived = usdcDelta; // positive

      if (position.qtyTokens > 0) {
        const avgCost = position.costBasisTotal / position.qtyTokens;
        const costRemoved = avgCost * Math.min(qtySold, position.qtyTokens);
        const pnl = usdcReceived - costRemoved;

        position.realizedPnl += pnl;
        walletState.totalRealizedPnl += pnl;
        position.qtyTokens -= qtySold;
        position.costBasisTotal = Math.max(0, position.costBasisTotal - costRemoved);
      } else {
        // Selling without position (short or already closed)
        // This could happen with complex strategies - treat as pure income
        position.realizedPnl += usdcReceived;
        walletState.totalRealizedPnl += usdcReceived;
        position.qtyTokens -= qtySold;
      }
    }
    // token_delta = 0 means no position change (shouldn't happen for CLOB)
  }

  /**
   * PositionSplit
   *
   * Set tokens → Leg tokens (internal conversion, no PnL)
   *
   * When a set is split:
   * - The set position loses tokens (token_delta < 0)
   * - The leg positions gain tokens (token_delta > 0)
   *
   * Cost basis should transfer proportionally from set to legs.
   * Since we process events per-position, we see individual entries.
   *
   * For now, treat token_delta > 0 as receiving tokens with 0 cost basis,
   * and token_delta < 0 as losing tokens (with cost basis transfer).
   *
   * A more sophisticated approach would track sets separately.
   */
  private applySplitEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    const tokenDelta = event.token_delta;
    const usdcDelta = event.usdc_delta;

    if (tokenDelta > 0) {
      // Receiving leg tokens from a split
      // In theory, cost should come from the set, but we don't track that directly
      // For now: tokens appear at $0 cost basis (conservative approach)
      // This means when they're redeemed/sold, all proceeds are profit
      position.qtyTokens += tokenDelta;
      // No cost basis added - this is a simplification
      // TODO: Track set → leg cost basis transfer properly
    } else if (tokenDelta < 0) {
      // Losing set tokens (being split)
      const qtyRemoved = Math.abs(tokenDelta);

      // Remove proportional cost basis
      if (position.qtyTokens > 0) {
        const costToRemove = (qtyRemoved / position.qtyTokens) * position.costBasisTotal;
        position.costBasisTotal = Math.max(0, position.costBasisTotal - costToRemove);
      }
      position.qtyTokens -= qtyRemoved;
    }

    // usdc_delta should be 0 for pure splits
    if (Math.abs(usdcDelta) > 0.01) {
      // Unexpected USDC movement in split
      this.errors.push(`Unexpected USDC in split: ${usdcDelta} for ${event.event_id}`);
    }
  }

  /**
   * PositionsMerge
   *
   * Two cases:
   * 1. Legs → Set tokens (reverse of split, no PnL)
   * 2. Legs → USDC (redemption at par, realize PnL)
   *
   * In ledger data:
   * - token_delta < 0 (losing leg tokens)
   * - usdc_delta > 0 (receiving USDC) for case 2
   * - usdc_delta = 0 for case 1 (just getting set tokens elsewhere)
   */
  private applyMergeEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    const tokenDelta = event.token_delta;
    const usdcDelta = event.usdc_delta;

    if (tokenDelta < 0) {
      // Losing tokens in a merge
      const qtyMerged = Math.abs(tokenDelta);

      if (usdcDelta > 0) {
        // Case 2: Legs → USDC (redemption)
        // This is a realization event
        if (position.qtyTokens > 0) {
          const avgCost = position.costBasisTotal / position.qtyTokens;
          const costRemoved = avgCost * Math.min(qtyMerged, position.qtyTokens);
          const pnl = usdcDelta - costRemoved;

          position.realizedPnl += pnl;
          walletState.totalRealizedPnl += pnl;
          position.costBasisTotal = Math.max(0, position.costBasisTotal - costRemoved);
        } else {
          // No position, treat USDC as pure income
          position.realizedPnl += usdcDelta;
          walletState.totalRealizedPnl += usdcDelta;
        }
        position.qtyTokens -= qtyMerged;
      } else {
        // Case 1: Legs → Set (no direct PnL)
        // Just remove tokens, cost basis transfers to set position
        if (position.qtyTokens > 0) {
          const costToTransfer = (qtyMerged / position.qtyTokens) * position.costBasisTotal;
          position.costBasisTotal = Math.max(0, position.costBasisTotal - costToTransfer);
        }
        position.qtyTokens -= qtyMerged;
        // TODO: Add cost basis to the set position
      }
    } else if (tokenDelta > 0) {
      // Receiving set tokens from a merge
      // In theory, cost basis should come from the legs
      position.qtyTokens += tokenDelta;
      // No cost basis added here - same limitation as splits
    }
  }

  /**
   * PayoutRedemption
   *
   * Settlement at resolution price:
   * - token_delta < 0 (tokens redeemed)
   * - usdc_delta > 0 (payout received)
   * - payout_norm indicates the resolution price (0 or 1 for binary)
   *
   * PnL = usdc_received - cost_basis_for_redeemed_tokens
   */
  private applyRedemptionEvent(
    position: PositionState,
    event: LedgerEvent,
    walletState: WalletState
  ): void {
    const tokenDelta = event.token_delta;
    const usdcDelta = event.usdc_delta;

    if (tokenDelta < 0) {
      const qtyRedeemed = Math.abs(tokenDelta);

      if (position.qtyTokens > 0) {
        const avgCost = position.costBasisTotal / position.qtyTokens;
        const costRemoved = avgCost * Math.min(qtyRedeemed, position.qtyTokens);
        const pnl = usdcDelta - costRemoved;

        position.realizedPnl += pnl;
        walletState.totalRealizedPnl += pnl;
        position.qtyTokens -= qtyRedeemed;
        position.costBasisTotal = Math.max(0, position.costBasisTotal - costRemoved);
      } else {
        // Redemption without recorded position (edge case)
        // Treat as pure income
        position.realizedPnl += usdcDelta;
        walletState.totalRealizedPnl += usdcDelta;
        position.qtyTokens -= qtyRedeemed;
      }
    }
  }

  /**
   * Process a batch of events (must be sorted by time)
   */
  processEvents(events: LedgerEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  /**
   * Calculate unrealized PnL for a wallet
   *
   * For each open position:
   *   unrealized_pnl = (current_price - avg_cost) * qty_tokens
   *
   * @param wallet The wallet address
   * @param priceOracle A function that returns current price for a position
   */
  calculateUnrealizedPnl(
    wallet: string,
    priceOracle: (conditionId: string, outcomeIndex: number) => number
  ): number {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return 0;

    let unrealizedPnl = 0;

    for (const [posKey, position] of walletState.positions) {
      if (Math.abs(position.qtyTokens) > 0.01) {
        const { conditionId, outcomeIndex } = parsePositionKey(posKey);
        const currentPrice = priceOracle(conditionId, outcomeIndex);
        const avgCost = position.qtyTokens > 0
          ? position.costBasisTotal / position.qtyTokens
          : 0;

        unrealizedPnl += (currentPrice - avgCost) * position.qtyTokens;
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
  ): EngineResult {
    const walletState = this.state.get(wallet.toLowerCase());

    if (!walletState) {
      return {
        wallet,
        totalRealizedPnl: 0,
        totalUnrealizedPnl: 0,
        totalPnl: 0,
        openPositions: 0,
        closedPositions: 0,
        eventsProcessed: 0,
        errors: [],
      };
    }

    let openPositions = 0;
    let closedPositions = 0;

    for (const position of walletState.positions.values()) {
      if (Math.abs(position.qtyTokens) > 0.01) {
        openPositions++;
      } else {
        closedPositions++;
      }
    }

    const unrealizedPnl = priceOracle
      ? this.calculateUnrealizedPnl(wallet, priceOracle)
      : 0;

    return {
      wallet,
      totalRealizedPnl: walletState.totalRealizedPnl,
      totalUnrealizedPnl: unrealizedPnl,
      totalPnl: walletState.totalRealizedPnl + unrealizedPnl,
      openPositions,
      closedPositions,
      eventsProcessed: this.eventsProcessed,
      errors: this.errors,
    };
  }

  /**
   * Get all wallet results
   */
  getAllResults(): EngineResult[] {
    const results: EngineResult[] = [];
    for (const wallet of this.state.keys()) {
      results.push(this.getWalletResult(wallet));
    }
    return results;
  }

  /**
   * Get position details for debugging
   */
  getPositionDetails(wallet: string): Array<{
    conditionId: string;
    outcomeIndex: number;
    qtyTokens: number;
    costBasis: number;
    avgCost: number;
    realizedPnl: number;
  }> {
    const walletState = this.state.get(wallet.toLowerCase());
    if (!walletState) return [];

    const details = [];
    for (const [posKey, position] of walletState.positions) {
      const { conditionId, outcomeIndex } = parsePositionKey(posKey);
      details.push({
        conditionId,
        outcomeIndex,
        qtyTokens: position.qtyTokens,
        costBasis: position.costBasisTotal,
        avgCost: position.qtyTokens > 0 ? position.costBasisTotal / position.qtyTokens : 0,
        realizedPnl: position.realizedPnl,
      });
    }
    return details;
  }

  /**
   * Reset the engine state
   */
  reset(): void {
    this.state.clear();
    this.eventsProcessed = 0;
    this.errors = [];
  }
}

// ============================================================================
// Factory function for convenience
// ============================================================================

export function createCostBasisEngine(): CostBasisEngine {
  return new CostBasisEngine();
}
