/**
 * Manual Copy Trade Engine
 *
 * Core engine for watching wallets and making copy trade decisions.
 *
 * Logic (no time window):
 * - Track every trade from watched wallets
 * - Per market+outcome, count unique wallets that have bet
 * - When consensus threshold is met, trigger paper trade
 * - Once triggered for a market+outcome, don't trigger again
 */

import type {
  ManualCopyTradeConfig,
  CopyTradeDecision,
  ConsensusMode,
  CopyTradeEvent,
} from "@/lib/contracts/strategyBuilder";
import { getExecutionAdapter } from "./executionAdapter";
import { addDecision } from "./logStore";
import { createPositionFromDecision } from "./positionStore";
import { alertConsensusMet, alertPositionOpened } from "./alertStore";
import { applyDefaultExitRules, startMonitor, getMonitorStatus } from "./priceMonitor";

// ============================================================================
// Types
// ============================================================================

interface MarketOutcomeTracker {
  consensusKey: string;
  conditionId: string;
  marketId: string;
  side: "buy" | "sell";
  outcome: string;
  walletsThatBet: Map<string, CopyTradeEvent>; // wallet -> their trade
  triggered: boolean; // Has consensus been reached and trade queued?
  triggeredAt?: string;
}

interface EngineState {
  config: ManualCopyTradeConfig;
  wallets: string[];
  // Track per market+side+outcome
  marketTrackers: Map<string, MarketOutcomeTracker>;
  // Deduplication
  seenTradeIds: Set<string>;
  // Optional market filter from upstream node
  allowedConditionIds?: Set<string>;
  isRunning: boolean;
}

// Global engine state (singleton for V1)
let engineState: EngineState | null = null;

// ============================================================================
// Wallet Parsing
// ============================================================================

/**
 * Parse comma-separated wallets, normalize addresses
 */
export function parseWalletsCsv(csv: string): string[] {
  if (!csv || !csv.trim()) return [];

  return csv
    .split(/[,\n]/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && w.startsWith("0x"))
    .filter((w, i, arr) => arr.indexOf(w) === i); // dedupe
}

// ============================================================================
// Consensus Logic
// ============================================================================

/**
 * Generate consensus key for a trade event
 * Key: conditionId:side:outcome
 */
export function generateConsensusKey(event: CopyTradeEvent): string {
  return [
    event.conditionId.toLowerCase(),
    event.side,
    event.outcome.toLowerCase(),
  ].join(":");
}

/**
 * Get required count for consensus mode
 */
export function getRequiredCount(
  mode: ConsensusMode,
  walletCount: number,
  nRequired?: number
): number {
  switch (mode) {
    case "any":
      return 1;
    case "two_agree":
      return 2;
    case "n_of_m":
      return nRequired || 2;
    case "all":
      return walletCount;
    default:
      return 1;
  }
}

// ============================================================================
// Engine Core
// ============================================================================

/**
 * Initialize the copy trade engine with config
 */
export function initializeEngine(
  config: ManualCopyTradeConfig,
  allowedConditionIds?: string[]
): { wallets: string[]; error?: string } {
  const wallets = parseWalletsCsv(config.walletsCsv);

  if (wallets.length === 0) {
    return { wallets: [], error: "No valid wallets found in CSV" };
  }

  engineState = {
    config,
    wallets,
    marketTrackers: new Map(),
    seenTradeIds: new Set(),
    allowedConditionIds: allowedConditionIds
      ? new Set(allowedConditionIds.map(c => c.toLowerCase()))
      : undefined,
    isRunning: true,
  };

  return { wallets };
}

/**
 * Stop the engine
 */
export function stopEngine(): void {
  if (engineState) {
    engineState.isRunning = false;
    engineState = null;
  }
}

/**
 * Get current engine state (for UI)
 */
export function getEngineState(): {
  isRunning: boolean;
  walletCount: number;
  bufferSize: number;
  config?: ManualCopyTradeConfig;
} {
  if (!engineState) {
    return { isRunning: false, walletCount: 0, bufferSize: 0 };
  }
  return {
    isRunning: engineState.isRunning,
    walletCount: engineState.wallets.length,
    bufferSize: engineState.marketTrackers.size,
    config: engineState.config,
  };
}

/**
 * Process an incoming trade event
 * Returns the decision if one was made
 */
export async function processTradeEvent(
  event: CopyTradeEvent
): Promise<CopyTradeDecision | null> {
  if (!engineState || !engineState.isRunning) {
    return null;
  }

  const { config, wallets, marketTrackers, seenTradeIds, allowedConditionIds } = engineState;

  // Check if this wallet is being tracked
  const walletLower = event.walletAddress.toLowerCase();
  if (!wallets.includes(walletLower)) {
    return null;
  }

  // Check market filter if applied
  if (allowedConditionIds && !allowedConditionIds.has(event.conditionId.toLowerCase())) {
    const decision = createDecision(event, config, wallets, [], "filtered", "market_not_in_filter");
    if (config.enableLogging) {
      addDecision(decision);
    }
    return decision;
  }

  // Check minimum notional filter
  const notional = event.notionalUsd ?? (event.price * event.size);
  if (config.minSourceNotionalUsd && notional < config.minSourceNotionalUsd) {
    const decision = createDecision(event, config, wallets, [walletLower], "filtered", `notional_below_min: ${notional.toFixed(2)}`);
    if (config.enableLogging) {
      addDecision(decision);
    }
    return decision;
  }

  // Dedupe check (by tradeId if available)
  const tradeId = (event as any).tradeId;
  if (tradeId && seenTradeIds.has(tradeId)) {
    return null; // Already processed this exact trade
  }
  if (tradeId) seenTradeIds.add(tradeId);

  // Get or create tracker for this market+side+outcome
  const consensusKey = generateConsensusKey(event);
  let tracker = marketTrackers.get(consensusKey);

  if (!tracker) {
    tracker = {
      consensusKey,
      conditionId: event.conditionId,
      marketId: event.marketId,
      side: event.side,
      outcome: event.outcome,
      walletsThatBet: new Map(),
      triggered: false,
    };
    marketTrackers.set(consensusKey, tracker);
  }

  // Check if this wallet already bet on this market+outcome
  if (tracker.walletsThatBet.has(walletLower)) {
    // Wallet already counted, just log and skip
    const decision = createDecision(
      event,
      config,
      wallets,
      Array.from(tracker.walletsThatBet.keys()),
      "skipped",
      "wallet_already_counted"
    );
    if (config.enableLogging) {
      addDecision(decision);
    }
    return decision;
  }

  // Add this wallet's trade
  tracker.walletsThatBet.set(walletLower, event);

  const uniqueWallets = Array.from(tracker.walletsThatBet.keys());
  const requiredCount = getRequiredCount(config.consensusMode, wallets.length, config.nRequired);

  // Check if already triggered
  if (tracker.triggered) {
    const decision = createDecision(
      event,
      config,
      wallets,
      uniqueWallets,
      "skipped",
      "already_triggered_for_this_market"
    );
    if (config.enableLogging) {
      addDecision(decision);
    }
    return decision;
  }

  // Check if consensus is now met
  if (uniqueWallets.length >= requiredCount) {
    // Mark as triggered
    tracker.triggered = true;
    tracker.triggeredAt = new Date().toISOString();

    // Execute (or simulate) the paper trade
    const adapter = getExecutionAdapter(config.dryRun);

    // Use the most recent trade's price/size as reference
    const result = await adapter.execute({
      conditionId: event.conditionId,
      marketId: event.marketId,
      side: event.side,
      outcome: event.outcome,
      price: event.price,
      size: event.size,
      maxCopyPerTradeUsd: config.maxCopyPerTradeUsd,
    });

    const decision = createDecision(
      event,
      config,
      wallets,
      uniqueWallets,
      result.status,
      result.reason,
      result.txHash,
      result.errorMessage
    );

    if (config.enableLogging) {
      addDecision(decision);
    }

    // Create alert for consensus trigger
    alertConsensusMet(
      event.marketId,
      event.conditionId,
      event.outcome,
      uniqueWallets,
      decision.decisionId
    );

    // Create paper position if execution succeeded
    if (result.status === "executed" || result.status === "simulated") {
      const position = createPositionFromDecision(decision);

      // Apply default exit rules (price target + stop loss)
      applyDefaultExitRules(position.positionId, decision.price);

      // Start price monitor if not already running
      const monitorStatus = getMonitorStatus();
      if (!monitorStatus.isRunning) {
        startMonitor();
      }

      // Create alert for position opened
      alertPositionOpened(
        position.positionId,
        event.marketId,
        event.conditionId,
        event.outcome,
        decision.size,
        decision.price
      );
    }

    return decision;
  }

  // Consensus not met yet - log the trade being tracked
  const decision = createDecision(
    event,
    config,
    wallets,
    uniqueWallets,
    "skipped",
    `waiting_for_consensus: ${uniqueWallets.length}/${requiredCount}`
  );

  if (config.enableLogging) {
    addDecision(decision);
  }

  return decision;
}

/**
 * Create a CopyTradeDecision object
 */
function createDecision(
  event: CopyTradeEvent,
  config: ManualCopyTradeConfig,
  allWallets: string[],
  matchedWallets: string[],
  status: CopyTradeDecision["status"],
  reason?: string,
  txHash?: string | null,
  errorMessage?: string | null
): CopyTradeDecision {
  return {
    decisionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sourceWallet: event.walletAddress,
    sourceTradeId: (event as any).tradeId,
    marketId: event.marketId,
    conditionId: event.conditionId,
    eventSlug: event.eventSlug,
    side: event.side,
    outcome: event.outcome,
    price: event.price,
    size: event.size,
    notionalUsd: event.notionalUsd,
    consensusKey: generateConsensusKey(event),
    consensusMode: config.consensusMode,
    matchedWallets,
    matchedCount: matchedWallets.length,
    requiredCount: getRequiredCount(config.consensusMode, allWallets.length, config.nRequired),
    status,
    reason,
    dryRun: config.dryRun,
    txHash: txHash ?? null,
    errorMessage: errorMessage ?? null,
  };
}

/**
 * Get current market trackers (for debugging/UI)
 */
export function getMarketTrackers(): Array<{
  consensusKey: string;
  marketId: string;
  side: string;
  outcome: string;
  walletsCount: number;
  triggered: boolean;
}> {
  if (!engineState) return [];

  return Array.from(engineState.marketTrackers.values()).map(t => ({
    consensusKey: t.consensusKey,
    marketId: t.marketId,
    side: t.side,
    outcome: t.outcome,
    walletsCount: t.walletsThatBet.size,
    triggered: t.triggered,
  }));
}

// ============================================================================
// Mock Trade Generator (for testing)
// ============================================================================

/**
 * Generate a mock trade event for testing
 */
export function generateMockTradeEvent(
  wallet: string,
  conditionId: string = "0x1234567890abcdef",
  side: "buy" | "sell" = "buy",
  outcome: string = "yes"
): CopyTradeEvent {
  return {
    walletAddress: wallet,
    timestamp: new Date().toISOString(),
    marketId: `market_${conditionId.slice(0, 8)}`,
    conditionId,
    eventSlug: "test-event",
    side,
    outcome,
    price: 0.5 + Math.random() * 0.3,
    size: 10 + Math.random() * 90,
    notionalUsd: undefined,
  };
}

/**
 * Simulate processing multiple trades for testing
 */
export async function simulateTradesForTesting(
  config: ManualCopyTradeConfig,
  trades: CopyTradeEvent[]
): Promise<CopyTradeDecision[]> {
  initializeEngine(config);

  const decisions: CopyTradeDecision[] = [];
  for (const trade of trades) {
    const decision = await processTradeEvent(trade);
    if (decision) {
      decisions.push(decision);
    }
  }

  stopEngine();
  return decisions;
}
