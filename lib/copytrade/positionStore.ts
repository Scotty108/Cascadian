/**
 * Position Store
 *
 * Tracks paper positions from copy trades.
 * Stores position state, calculates P&L, tracks resolved markets.
 */

import type { CopyTradeDecision } from "@/lib/contracts/strategyBuilder";

// ============================================================================
// Types
// ============================================================================

export interface PaperPosition {
  positionId: string;

  // Source info
  decisionId: string;
  sourceWallets: string[];

  // Market info
  marketId: string;
  conditionId: string;
  eventSlug?: string;

  // Position details
  side: "buy" | "sell";
  outcome: string;
  entryPrice: number;
  size: number;
  notionalUsd: number;

  // Timestamps
  openedAt: string;
  closedAt?: string;

  // Current state
  status: "open" | "closed" | "resolved";
  currentPrice?: number;
  lastPriceUpdate?: string;

  // P&L
  unrealizedPnl?: number;
  realizedPnl?: number;

  // Resolution
  resolutionOutcome?: string; // "yes", "no", or outcome name
  resolutionPrice?: number;   // 0 or 1 typically

  // Exit info
  exitReason?: "price_target" | "stop_loss" | "wallet_exit" | "manual" | "resolved";
  exitPrice?: number;
}

export interface PositionSummary {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  resolvedPositions: number;

  totalInvested: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;

  winCount: number;
  lossCount: number;
  winRate: number;
}

export interface ExitRule {
  type: "price_target" | "stop_loss" | "trailing_stop" | "wallet_exit";
  targetPrice?: number;     // For price_target
  stopPrice?: number;       // For stop_loss
  trailingPercent?: number; // For trailing_stop
  wallets?: string[];       // For wallet_exit
}

// ============================================================================
// Store (in-memory singleton)
// ============================================================================

const positions: Map<string, PaperPosition> = new Map();
const exitRules: Map<string, ExitRule[]> = new Map(); // positionId -> rules

// ============================================================================
// Position Management
// ============================================================================

/**
 * Create a position from a copy trade decision
 */
export function createPositionFromDecision(decision: CopyTradeDecision): PaperPosition {
  const positionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const position: PaperPosition = {
    positionId,
    decisionId: decision.decisionId,
    sourceWallets: decision.matchedWallets,
    marketId: decision.marketId,
    conditionId: decision.conditionId,
    eventSlug: decision.eventSlug,
    side: decision.side,
    outcome: decision.outcome,
    entryPrice: decision.price,
    size: decision.size,
    notionalUsd: decision.notionalUsd ?? (decision.price * decision.size),
    openedAt: decision.timestamp,
    status: "open",
    currentPrice: decision.price,
    lastPriceUpdate: decision.timestamp,
    unrealizedPnl: 0,
  };

  positions.set(positionId, position);
  return position;
}

/**
 * Update position price and calculate unrealized P&L
 */
export function updatePositionPrice(positionId: string, currentPrice: number): PaperPosition | null {
  const position = positions.get(positionId);
  if (!position || position.status !== "open") return null;

  position.currentPrice = currentPrice;
  position.lastPriceUpdate = new Date().toISOString();

  // Calculate unrealized P&L
  // For a YES buy: profit = (currentPrice - entryPrice) * size
  // For a NO buy (or YES sell): profit = (entryPrice - currentPrice) * size
  if (position.side === "buy") {
    position.unrealizedPnl = (currentPrice - position.entryPrice) * position.size;
  } else {
    position.unrealizedPnl = (position.entryPrice - currentPrice) * position.size;
  }

  return position;
}

/**
 * Close a position manually or via exit rule
 */
export function closePosition(
  positionId: string,
  exitPrice: number,
  exitReason: PaperPosition["exitReason"]
): PaperPosition | null {
  const position = positions.get(positionId);
  if (!position || position.status !== "open") return null;

  position.status = "closed";
  position.closedAt = new Date().toISOString();
  position.exitPrice = exitPrice;
  position.exitReason = exitReason;

  // Calculate realized P&L
  if (position.side === "buy") {
    position.realizedPnl = (exitPrice - position.entryPrice) * position.size;
  } else {
    position.realizedPnl = (position.entryPrice - exitPrice) * position.size;
  }

  position.unrealizedPnl = undefined;

  return position;
}

/**
 * Mark position as resolved
 */
export function resolvePosition(
  positionId: string,
  resolutionOutcome: string,
  resolutionPrice: number // 0 or 1
): PaperPosition | null {
  const position = positions.get(positionId);
  if (!position) return null;

  position.status = "resolved";
  position.closedAt = new Date().toISOString();
  position.resolutionOutcome = resolutionOutcome;
  position.resolutionPrice = resolutionPrice;
  position.exitReason = "resolved";

  // For resolution: if we bet YES and YES wins, we get $1 per share
  // If we bet YES and NO wins, we get $0
  const didWin = position.outcome.toLowerCase() === resolutionOutcome.toLowerCase();
  const payout = didWin ? 1 : 0;

  if (position.side === "buy") {
    position.realizedPnl = (payout - position.entryPrice) * position.size;
  } else {
    // Selling means we bet against, so inverse
    position.realizedPnl = (position.entryPrice - payout) * position.size;
  }

  position.unrealizedPnl = undefined;

  return position;
}

// ============================================================================
// Exit Rules
// ============================================================================

/**
 * Add exit rule to a position
 */
export function addExitRule(positionId: string, rule: ExitRule): void {
  const rules = exitRules.get(positionId) || [];
  rules.push(rule);
  exitRules.set(positionId, rules);
}

/**
 * Check if any exit rules are triggered
 */
export function checkExitRules(positionId: string, currentPrice: number): ExitRule | null {
  const position = positions.get(positionId);
  if (!position || position.status !== "open") return null;

  const rules = exitRules.get(positionId) || [];

  for (const rule of rules) {
    if (rule.type === "price_target" && rule.targetPrice !== undefined) {
      if (currentPrice >= rule.targetPrice) {
        return rule;
      }
    }

    if (rule.type === "stop_loss" && rule.stopPrice !== undefined) {
      if (currentPrice <= rule.stopPrice) {
        return rule;
      }
    }
  }

  return null;
}

/**
 * Get exit rules for position
 */
export function getExitRules(positionId: string): ExitRule[] {
  return exitRules.get(positionId) || [];
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all positions
 */
export function getAllPositions(): PaperPosition[] {
  return Array.from(positions.values());
}

/**
 * Get open positions
 */
export function getOpenPositions(): PaperPosition[] {
  return Array.from(positions.values()).filter(p => p.status === "open");
}

/**
 * Get positions by market
 */
export function getPositionsByMarket(conditionId: string): PaperPosition[] {
  return Array.from(positions.values()).filter(
    p => p.conditionId.toLowerCase() === conditionId.toLowerCase()
  );
}

/**
 * Get position by ID
 */
export function getPosition(positionId: string): PaperPosition | null {
  return positions.get(positionId) || null;
}

/**
 * Get summary statistics
 */
export function getPositionSummary(): PositionSummary {
  const all = Array.from(positions.values());
  const open = all.filter(p => p.status === "open");
  const closed = all.filter(p => p.status === "closed" || p.status === "resolved");

  let totalInvested = 0;
  let totalUnrealizedPnl = 0;
  let totalRealizedPnl = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const p of all) {
    totalInvested += p.notionalUsd;

    if (p.unrealizedPnl !== undefined) {
      totalUnrealizedPnl += p.unrealizedPnl;
    }

    if (p.realizedPnl !== undefined) {
      totalRealizedPnl += p.realizedPnl;
      if (p.realizedPnl > 0) winCount++;
      if (p.realizedPnl < 0) lossCount++;
    }
  }

  const winRate = (winCount + lossCount) > 0
    ? (winCount / (winCount + lossCount)) * 100
    : 0;

  return {
    totalPositions: all.length,
    openPositions: open.length,
    closedPositions: closed.filter(p => p.status === "closed").length,
    resolvedPositions: closed.filter(p => p.status === "resolved").length,
    totalInvested,
    totalUnrealizedPnl,
    totalRealizedPnl,
    winCount,
    lossCount,
    winRate,
  };
}

/**
 * Get performance by wallet
 */
export function getPerformanceByWallet(): Map<string, { trades: number; pnl: number; winRate: number }> {
  const walletPerf = new Map<string, { trades: number; totalPnl: number; wins: number; losses: number }>();

  for (const p of positions.values()) {
    for (const wallet of p.sourceWallets) {
      const existing = walletPerf.get(wallet) || { trades: 0, totalPnl: 0, wins: 0, losses: 0 };
      existing.trades++;

      const pnl = p.realizedPnl ?? p.unrealizedPnl ?? 0;
      existing.totalPnl += pnl;

      if (p.realizedPnl !== undefined) {
        if (p.realizedPnl > 0) existing.wins++;
        if (p.realizedPnl < 0) existing.losses++;
      }

      walletPerf.set(wallet, existing);
    }
  }

  const result = new Map<string, { trades: number; pnl: number; winRate: number }>();

  for (const [wallet, perf] of walletPerf) {
    const total = perf.wins + perf.losses;
    result.set(wallet, {
      trades: perf.trades,
      pnl: perf.totalPnl,
      winRate: total > 0 ? (perf.wins / total) * 100 : 0,
    });
  }

  return result;
}

/**
 * Clear all positions (for testing)
 */
export function clearPositions(): void {
  positions.clear();
  exitRules.clear();
}
