/**
 * Cost Basis PnL Engine V1
 *
 * Implements Polymarket-style cost basis accounting:
 * - Weighted average cost basis on buys
 * - Sell capping to prevent negative balances
 * - Realized PnL tracking on sells
 *
 * Key insight: This matches how Polymarket's subgraph calculates PnL,
 * which caps sells at tracked inventory and ignores tokens acquired
 * outside the tracked data source.
 */

export interface Position {
  wallet: string;
  tokenId: string;
  amount: number; // Current token balance (>=0)
  avgPrice: number; // Weighted average cost basis
  realizedPnl: number; // Cumulative realized PnL from sells
}

export interface TradeEvent {
  eventId: string;
  wallet: string;
  tokenId: string;
  side: 'buy' | 'sell';
  tokenAmount: number;
  usdcAmount: number;
  timestamp: Date;
}

export interface SellResult {
  effectiveAmount: number;
  externalSell: number;
  realizedPnl: number;
}

export interface PositionState {
  positions: Map<string, Position>; // key: tokenId
  totalRealizedPnl: number;
  totalExternalSells: number;
  externalSellsByToken: Map<string, number>;
}

/**
 * Create a unique key for position tracking
 */
export function positionKey(wallet: string, tokenId: string): string {
  return `${wallet.toLowerCase()}_${tokenId}`;
}

/**
 * Initialize an empty position
 */
export function emptyPosition(wallet: string, tokenId: string): Position {
  return {
    wallet: wallet.toLowerCase(),
    tokenId,
    amount: 0,
    avgPrice: 0,
    realizedPnl: 0,
  };
}

/**
 * Update position with a BUY trade
 * Uses weighted average cost basis formula
 */
export function updateWithBuy(position: Position, amount: number, price: number): Position {
  if (amount <= 0) return position;

  // Calculate weighted average cost basis
  const totalCost = position.amount * position.avgPrice + amount * price;
  const newAmount = position.amount + amount;

  return {
    ...position,
    amount: newAmount,
    avgPrice: newAmount > 0 ? totalCost / newAmount : price,
  };
}

/**
 * Update position with a SELL trade
 * CAPS sell at tracked inventory (critical for matching Polymarket)
 */
export function updateWithSell(
  position: Position,
  amount: number,
  price: number
): { position: Position; result: SellResult } {
  if (amount <= 0) {
    return {
      position,
      result: { effectiveAmount: 0, externalSell: 0, realizedPnl: 0 },
    };
  }

  // CAP sell at tracked inventory (Polymarket behavior)
  const effectiveAmount = Math.min(amount, position.amount);
  const externalSell = amount - effectiveAmount;

  // Realize PnL only on tracked inventory
  // Formula: effectiveAmount * (sellPrice - avgPrice)
  const realizedPnl = effectiveAmount * (price - position.avgPrice);

  return {
    position: {
      ...position,
      amount: position.amount - effectiveAmount,
      realizedPnl: position.realizedPnl + realizedPnl,
      // Keep avgPrice even when amount becomes 0 (for reopening positions)
    },
    result: {
      effectiveAmount,
      externalSell,
      realizedPnl,
    },
  };
}

/**
 * Calculate unrealized PnL for a position at current/resolution price
 */
export function calculateUnrealizedPnl(position: Position, currentPrice: number): number {
  return position.amount * (currentPrice - position.avgPrice);
}

/**
 * Calculate total PnL (realized + unrealized)
 */
export function calculateTotalPnl(position: Position, currentPrice: number): number {
  const unrealized = calculateUnrealizedPnl(position, currentPrice);
  return position.realizedPnl + unrealized;
}

/**
 * Process a list of trades and return final position states
 */
export function processTradesForWallet(
  wallet: string,
  trades: TradeEvent[],
  resolutions: Map<string, number> // tokenId -> resolution price (1 or 0)
): {
  positions: Position[];
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalPnl: number;
  totalExternalSells: number;
  externalSellsByToken: Map<string, number>;
} {
  const positionMap = new Map<string, Position>();
  const externalSellsByToken = new Map<string, number>();
  let totalExternalSells = 0;

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  for (const trade of sortedTrades) {
    if (trade.wallet.toLowerCase() !== wallet.toLowerCase()) continue;

    const tokenId = trade.tokenId;
    let position = positionMap.get(tokenId) || emptyPosition(wallet, tokenId);

    // Calculate implied price from trade
    const price = trade.tokenAmount > 0 ? trade.usdcAmount / trade.tokenAmount : 0;

    if (trade.side === 'buy') {
      position = updateWithBuy(position, trade.tokenAmount, price);
    } else {
      const { position: newPos, result } = updateWithSell(position, trade.tokenAmount, price);
      position = newPos;

      if (result.externalSell > 0) {
        totalExternalSells += result.externalSell;
        externalSellsByToken.set(
          tokenId,
          (externalSellsByToken.get(tokenId) || 0) + result.externalSell
        );
      }
    }

    positionMap.set(tokenId, position);
  }

  // Calculate final PnL
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;

  for (const [tokenId, position] of positionMap) {
    totalRealizedPnl += position.realizedPnl;

    // Get resolution price if available, otherwise use 0 for unrealized
    const resolutionPrice = resolutions.get(tokenId);
    if (resolutionPrice !== undefined && position.amount > 0) {
      // For resolved markets: final payout - cost basis
      const unrealized = position.amount * resolutionPrice - position.amount * position.avgPrice;
      totalUnrealizedPnl += unrealized;
    }
    // For unresolved markets, we'd need current market price (not implemented here)
  }

  return {
    positions: Array.from(positionMap.values()),
    totalRealizedPnl,
    totalUnrealizedPnl,
    totalPnl: totalRealizedPnl + totalUnrealizedPnl,
    totalExternalSells,
    externalSellsByToken,
  };
}

/**
 * Diagnostic: Check position health invariants
 */
export function checkPositionHealth(positions: Position[]): {
  valid: boolean;
  negativeBalances: number;
  issues: string[];
} {
  const issues: string[] = [];
  let negativeBalances = 0;

  for (const pos of positions) {
    if (pos.amount < -0.001) {
      negativeBalances++;
      issues.push(`Negative balance: ${pos.tokenId.slice(0, 20)}... = ${pos.amount}`);
    }
    if (pos.avgPrice < 0 || pos.avgPrice > 2) {
      issues.push(`Invalid avgPrice: ${pos.tokenId.slice(0, 20)}... = ${pos.avgPrice}`);
    }
  }

  return {
    valid: negativeBalances === 0 && issues.length === 0,
    negativeBalances,
    issues,
  };
}
