/**
 * Price Monitor Service
 *
 * Monitors prices for open positions and triggers exit rules.
 * Runs in-memory (singleton) - call startMonitor() to begin.
 */

import {
  getOpenPositions,
  updatePositionPrice,
  closePosition,
  checkExitRules,
  addExitRule,
  type PaperPosition,
  type ExitRule,
} from "./positionStore";
import { alertExitTriggered } from "./alertStore";

// ============================================================================
// Types
// ============================================================================

interface MonitorConfig {
  pollIntervalMs: number;
  defaultPriceTargetPct: number; // e.g., 20 = +20%
  defaultStopLossPct: number;    // e.g., 10 = -10%
  followWalletExits: boolean;
}

interface MonitorState {
  config: MonitorConfig;
  isRunning: boolean;
  intervalId: NodeJS.Timeout | null;
  lastCheck: string | null;
  checksPerformed: number;
  exitsTriggered: number;
}

// ============================================================================
// Global State
// ============================================================================

let monitorState: MonitorState | null = null;

const DEFAULT_CONFIG: MonitorConfig = {
  pollIntervalMs: 10000, // 10 seconds
  defaultPriceTargetPct: 20,
  defaultStopLossPct: 10,
  followWalletExits: true,
};

// ============================================================================
// Price Fetching (mock for now - replace with real API)
// ============================================================================

/**
 * Fetch current price for a market outcome
 * TODO: Replace with real Polymarket/Dome API call
 */
async function fetchMarketPrice(conditionId: string, outcome: string): Promise<number | null> {
  // For now, return a mock price that fluctuates slightly
  // In production, this would call the Dome API or Polymarket API
  try {
    // Try to fetch from Dome API
    const response = await fetch(
      `https://api.domeapi.io/v1/markets?condition_id=${conditionId}`,
      {
        headers: {
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.markets && data.markets.length > 0) {
        const market = data.markets[0];
        // Return price based on outcome
        if (outcome.toLowerCase() === "yes") {
          return market.yes_price ?? market.best_bid ?? null;
        } else {
          return market.no_price ?? (1 - (market.best_bid ?? 0.5));
        }
      }
    }
  } catch (error) {
    // Silently fail - will use mock
  }

  // Mock fallback: return null to indicate no price available
  return null;
}

// ============================================================================
// Monitor Logic
// ============================================================================

/**
 * Check prices and exit rules for all open positions
 */
async function checkPositions(): Promise<void> {
  if (!monitorState || !monitorState.isRunning) return;

  const openPositions = getOpenPositions();
  monitorState.checksPerformed++;
  monitorState.lastCheck = new Date().toISOString();

  for (const position of openPositions) {
    try {
      // Fetch current price
      const currentPrice = await fetchMarketPrice(position.conditionId, position.outcome);

      if (currentPrice === null) {
        // No price available, skip this position
        continue;
      }

      // Update position price
      updatePositionPrice(position.positionId, currentPrice);

      // Check exit rules
      const triggeredRule = checkExitRules(position.positionId, currentPrice);

      if (triggeredRule) {
        // Exit triggered!
        const exitReason = triggeredRule.type === "price_target" ? "price_target" : "stop_loss";
        const closedPosition = closePosition(position.positionId, currentPrice, exitReason);

        if (closedPosition) {
          monitorState.exitsTriggered++;

          // Create alert
          alertExitTriggered(
            position.positionId,
            position.marketId,
            exitReason,
            closedPosition.realizedPnl ?? 0
          );

          console.log(
            `[PriceMonitor] Exit triggered for ${position.positionId}: ${exitReason} at $${currentPrice.toFixed(3)}`
          );
        }
      }
    } catch (error) {
      console.error(`[PriceMonitor] Error checking position ${position.positionId}:`, error);
    }
  }
}

/**
 * Apply default exit rules to a position
 */
export function applyDefaultExitRules(
  positionId: string,
  entryPrice: number,
  config?: Partial<MonitorConfig>
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Price target: entry + X%
  const targetPrice = entryPrice * (1 + cfg.defaultPriceTargetPct / 100);
  addExitRule(positionId, {
    type: "price_target",
    targetPrice,
  });

  // Stop loss: entry - X%
  const stopPrice = entryPrice * (1 - cfg.defaultStopLossPct / 100);
  addExitRule(positionId, {
    type: "stop_loss",
    stopPrice,
  });
}

// ============================================================================
// Monitor Control
// ============================================================================

/**
 * Start the price monitor
 */
export function startMonitor(config?: Partial<MonitorConfig>): void {
  if (monitorState?.isRunning) {
    console.log("[PriceMonitor] Already running");
    return;
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };

  monitorState = {
    config: cfg,
    isRunning: true,
    intervalId: null,
    lastCheck: null,
    checksPerformed: 0,
    exitsTriggered: 0,
  };

  // Start polling
  monitorState.intervalId = setInterval(() => {
    checkPositions();
  }, cfg.pollIntervalMs);

  // Run first check immediately
  checkPositions();

  console.log(`[PriceMonitor] Started with ${cfg.pollIntervalMs}ms interval`);
}

/**
 * Stop the price monitor
 */
export function stopMonitor(): void {
  if (!monitorState) return;

  if (monitorState.intervalId) {
    clearInterval(monitorState.intervalId);
  }

  monitorState.isRunning = false;
  monitorState.intervalId = null;

  console.log("[PriceMonitor] Stopped");
}

/**
 * Get monitor status
 */
export function getMonitorStatus(): {
  isRunning: boolean;
  lastCheck: string | null;
  checksPerformed: number;
  exitsTriggered: number;
  openPositionsCount: number;
} {
  return {
    isRunning: monitorState?.isRunning ?? false,
    lastCheck: monitorState?.lastCheck ?? null,
    checksPerformed: monitorState?.checksPerformed ?? 0,
    exitsTriggered: monitorState?.exitsTriggered ?? 0,
    openPositionsCount: getOpenPositions().length,
  };
}

/**
 * Update monitor config
 */
export function updateMonitorConfig(config: Partial<MonitorConfig>): void {
  if (!monitorState) return;

  monitorState.config = { ...monitorState.config, ...config };

  // Restart with new interval if changed
  if (config.pollIntervalMs && monitorState.intervalId) {
    clearInterval(monitorState.intervalId);
    monitorState.intervalId = setInterval(() => {
      checkPositions();
    }, monitorState.config.pollIntervalMs);
  }
}
