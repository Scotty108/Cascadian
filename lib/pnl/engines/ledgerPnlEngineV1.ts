/**
 * Ledger-based PnL Engine V1
 *
 * Implements proper inventory tracking with cost basis to match Polymarket UI.
 *
 * Key design decisions:
 * - Uses average cost basis (not FIFO) for simplicity
 * - Includes BOTH maker AND taker fills (confirmed via UI comparison)
 * - Handles ERC1155 transfers with cost basis propagation
 * - Tracks per-token inventory (condition_id + outcome_index)
 *
 * Formula per position:
 * - Buy: shares += qty, cost_basis += usdc_spent
 * - Sell: realized_pnl += usdc_received - (avg_cost * shares_sold), shares -= qty
 * - Transfer in: shares += qty, cost_basis += sender_avg_cost * qty
 * - Transfer out: shares -= qty, cost_basis -= my_avg_cost * qty
 * - Settlement: realized_pnl += shares * resolution_price - remaining_basis
 */

export interface TokenInventory {
  tokenId: string; // condition_id:outcome_index
  shares: number;
  costBasis: number; // total USDC spent to acquire these shares
}

export interface CashFlowEvent {
  eventId: string;
  timestamp: Date;
  type: 'trade' | 'transfer_in' | 'transfer_out' | 'redemption' | 'settlement';
  tokenId: string;
  side?: 'buy' | 'sell';
  shares: number;
  usdcAmount: number;
  counterparty?: string; // for transfers
}

export interface LedgerPnlResult {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalVolume: number;
  gain: number;
  loss: number;
  inventory: Map<string, TokenInventory>;
  events: CashFlowEvent[];
  debug: {
    tradeCount: number;
    transferInCount: number;
    transferOutCount: number;
    settlementCount: number;
  };
}

export class LedgerPnlEngine {
  private inventory: Map<string, TokenInventory> = new Map();
  private realizedPnl: number = 0;
  private totalVolume: number = 0;
  private gain: number = 0;
  private loss: number = 0;
  private events: CashFlowEvent[] = [];
  private debug = {
    tradeCount: 0,
    transferInCount: 0,
    transferOutCount: 0,
    settlementCount: 0,
  };

  constructor(private wallet: string) {}

  /**
   * Process a trade event (buy or sell)
   */
  processTrade(event: {
    eventId: string;
    timestamp: Date;
    tokenId: string;
    side: 'buy' | 'sell';
    shares: number;
    usdcAmount: number;
  }): void {
    const inv = this.getOrCreateInventory(event.tokenId);
    this.totalVolume += Math.abs(event.usdcAmount);
    this.debug.tradeCount++;

    if (event.side === 'buy') {
      // Buy: increase shares, increase cost basis
      inv.shares += event.shares;
      inv.costBasis += event.usdcAmount;
    } else {
      // Sell: decrease shares, realize PnL based on avg cost
      const avgCost = inv.shares > 0 ? inv.costBasis / inv.shares : 0;
      const basisRemoved = avgCost * event.shares;
      const tradePnl = event.usdcAmount - basisRemoved;

      this.realizedPnl += tradePnl;
      if (tradePnl >= 0) {
        this.gain += tradePnl;
      } else {
        this.loss += tradePnl;
      }

      inv.shares -= event.shares;
      inv.costBasis -= basisRemoved;

      // Clamp to zero if floating point drift
      if (inv.shares < 0.0001) {
        inv.shares = 0;
        inv.costBasis = 0;
      }
    }

    this.events.push({
      eventId: event.eventId,
      timestamp: event.timestamp,
      type: 'trade',
      tokenId: event.tokenId,
      side: event.side,
      shares: event.shares,
      usdcAmount: event.usdcAmount,
    });
  }

  /**
   * Process an ERC1155 transfer into this wallet
   * Cost basis must be provided (ideally from sender's avg cost)
   */
  processTransferIn(event: {
    eventId: string;
    timestamp: Date;
    tokenId: string;
    shares: number;
    costBasis: number; // basis from sender
    from: string;
  }): void {
    const inv = this.getOrCreateInventory(event.tokenId);
    inv.shares += event.shares;
    inv.costBasis += event.costBasis;
    this.debug.transferInCount++;

    this.events.push({
      eventId: event.eventId,
      timestamp: event.timestamp,
      type: 'transfer_in',
      tokenId: event.tokenId,
      shares: event.shares,
      usdcAmount: event.costBasis,
      counterparty: event.from,
    });
  }

  /**
   * Process an ERC1155 transfer out of this wallet
   * Cost basis moves with the tokens (proportional to avg cost)
   */
  processTransferOut(event: {
    eventId: string;
    timestamp: Date;
    tokenId: string;
    shares: number;
    to: string;
  }): { basisTransferred: number } {
    const inv = this.getOrCreateInventory(event.tokenId);
    const avgCost = inv.shares > 0 ? inv.costBasis / inv.shares : 0;
    const basisTransferred = avgCost * event.shares;

    inv.shares -= event.shares;
    inv.costBasis -= basisTransferred;
    this.debug.transferOutCount++;

    // Clamp to zero
    if (inv.shares < 0.0001) {
      inv.shares = 0;
      inv.costBasis = 0;
    }

    this.events.push({
      eventId: event.eventId,
      timestamp: event.timestamp,
      type: 'transfer_out',
      tokenId: event.tokenId,
      shares: event.shares,
      usdcAmount: basisTransferred,
      counterparty: event.to,
    });

    return { basisTransferred };
  }

  /**
   * Process a settlement/redemption event
   * When a market resolves, shares convert to USDC at resolution price
   */
  processSettlement(event: {
    eventId: string;
    timestamp: Date;
    tokenId: string;
    shares: number;
    payoutPerShare: number; // 0 for losing outcome, 1 for winning
  }): void {
    const inv = this.getOrCreateInventory(event.tokenId);
    const payout = event.shares * event.payoutPerShare;
    const avgCost = inv.shares > 0 ? inv.costBasis / inv.shares : 0;
    const basisRemoved = avgCost * event.shares;
    const settlementPnl = payout - basisRemoved;

    this.realizedPnl += settlementPnl;
    if (settlementPnl >= 0) {
      this.gain += settlementPnl;
    } else {
      this.loss += settlementPnl;
    }

    inv.shares -= event.shares;
    inv.costBasis -= basisRemoved;
    this.debug.settlementCount++;

    // Clamp to zero
    if (inv.shares < 0.0001) {
      inv.shares = 0;
      inv.costBasis = 0;
    }

    this.events.push({
      eventId: event.eventId,
      timestamp: event.timestamp,
      type: 'settlement',
      tokenId: event.tokenId,
      shares: event.shares,
      usdcAmount: payout,
    });
  }

  /**
   * Calculate unrealized PnL for current inventory
   * Requires current prices for each token
   */
  calculateUnrealizedPnl(currentPrices: Map<string, number>): number {
    let unrealized = 0;
    for (const [tokenId, inv] of this.inventory.entries()) {
      if (inv.shares > 0) {
        const currentPrice = currentPrices.get(tokenId) ?? 0;
        const currentValue = inv.shares * currentPrice;
        unrealized += currentValue - inv.costBasis;
      }
    }
    return unrealized;
  }

  /**
   * Get final result
   */
  getResult(currentPrices?: Map<string, number>): LedgerPnlResult {
    const unrealizedPnl = currentPrices
      ? this.calculateUnrealizedPnl(currentPrices)
      : 0;

    return {
      wallet: this.wallet,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      totalPnl: this.realizedPnl + unrealizedPnl,
      totalVolume: this.totalVolume,
      gain: this.gain,
      loss: this.loss,
      inventory: new Map(this.inventory),
      events: [...this.events],
      debug: { ...this.debug },
    };
  }

  /**
   * Get debug breakdown for a specific token
   */
  getTokenBreakdown(tokenId: string): TokenInventory | undefined {
    return this.inventory.get(tokenId);
  }

  private getOrCreateInventory(tokenId: string): TokenInventory {
    let inv = this.inventory.get(tokenId);
    if (!inv) {
      inv = { tokenId, shares: 0, costBasis: 0 };
      this.inventory.set(tokenId, inv);
    }
    return inv;
  }
}

/**
 * Helper to create token ID from condition_id and outcome_index
 */
export function makeTokenId(conditionId: string, outcomeIndex: number): string {
  return `${conditionId.toLowerCase()}:${outcomeIndex}`;
}
