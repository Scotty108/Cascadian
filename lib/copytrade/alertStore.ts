/**
 * Alert Store
 *
 * Manages alerts from copy trade events.
 * Stores alerts in-memory with ring buffer (max 500).
 */

// ============================================================================
// Types
// ============================================================================

export type AlertType =
  | "consensus_triggered"   // Copy trade consensus met
  | "position_opened"       // New position created
  | "exit_triggered"        // Exit rule hit
  | "position_resolved"     // Market resolved
  | "price_alert"           // Price threshold crossed
  | "wallet_activity";      // Tracked wallet did something

export type AlertPriority = "low" | "medium" | "high" | "critical";

export interface CopyTradeAlert {
  alertId: string;
  type: AlertType;
  priority: AlertPriority;
  timestamp: string;

  // Context
  title: string;
  message: string;

  // Related entities (optional)
  positionId?: string;
  decisionId?: string;
  marketId?: string;
  conditionId?: string;
  wallets?: string[];

  // State
  read: boolean;
  dismissed: boolean;
}

// ============================================================================
// Store (ring buffer)
// ============================================================================

const MAX_ALERTS = 500;
const alerts: CopyTradeAlert[] = [];

// ============================================================================
// Alert Creation
// ============================================================================

/**
 * Create and store an alert
 */
export function createAlert(
  type: AlertType,
  priority: AlertPriority,
  title: string,
  message: string,
  context?: {
    positionId?: string;
    decisionId?: string;
    marketId?: string;
    conditionId?: string;
    wallets?: string[];
  }
): CopyTradeAlert {
  const alert: CopyTradeAlert = {
    alertId: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    priority,
    timestamp: new Date().toISOString(),
    title,
    message,
    ...context,
    read: false,
    dismissed: false,
  };

  // Ring buffer - remove oldest if full
  if (alerts.length >= MAX_ALERTS) {
    alerts.shift();
  }

  alerts.push(alert);
  return alert;
}

// ============================================================================
// Helper Creators
// ============================================================================

/**
 * Alert when consensus triggers a copy trade
 */
export function alertConsensusMet(
  marketId: string,
  conditionId: string,
  outcome: string,
  wallets: string[],
  decisionId: string
): CopyTradeAlert {
  return createAlert(
    "consensus_triggered",
    "high",
    `Copy Trade Triggered`,
    `${wallets.length} wallets agreed on ${outcome.toUpperCase()} - paper trade queued`,
    { marketId, conditionId, wallets, decisionId }
  );
}

/**
 * Alert when position is opened
 */
export function alertPositionOpened(
  positionId: string,
  marketId: string,
  conditionId: string,
  outcome: string,
  size: number,
  price: number
): CopyTradeAlert {
  return createAlert(
    "position_opened",
    "medium",
    `Position Opened`,
    `${outcome.toUpperCase()} @ $${price.toFixed(2)} (${size.toFixed(0)} shares)`,
    { positionId, marketId, conditionId }
  );
}

/**
 * Alert when exit rule triggers
 */
export function alertExitTriggered(
  positionId: string,
  marketId: string,
  exitType: string,
  pnl: number
): CopyTradeAlert {
  const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
  return createAlert(
    "exit_triggered",
    pnl >= 0 ? "medium" : "high",
    `Exit Triggered: ${exitType}`,
    `Position closed with ${pnlStr} P&L`,
    { positionId, marketId }
  );
}

/**
 * Alert when market resolves
 */
export function alertMarketResolved(
  positionId: string,
  marketId: string,
  conditionId: string,
  winningOutcome: string,
  pnl: number
): CopyTradeAlert {
  const won = pnl > 0;
  const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

  return createAlert(
    "position_resolved",
    won ? "high" : "medium",
    won ? `Market Won!` : `Market Lost`,
    `${winningOutcome.toUpperCase()} won - ${pnlStr}`,
    { positionId, marketId, conditionId }
  );
}

/**
 * Alert for tracked wallet activity
 */
export function alertWalletActivity(
  wallet: string,
  action: string,
  marketId: string,
  details: string
): CopyTradeAlert {
  return createAlert(
    "wallet_activity",
    "low",
    `Wallet Activity`,
    `${wallet.slice(0, 8)}... ${action}: ${details}`,
    { wallets: [wallet], marketId }
  );
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all alerts (newest first)
 */
export function getAlerts(options?: {
  limit?: number;
  type?: AlertType;
  priority?: AlertPriority;
  unreadOnly?: boolean;
}): CopyTradeAlert[] {
  let result = [...alerts].reverse();

  if (options?.type) {
    result = result.filter(a => a.type === options.type);
  }

  if (options?.priority) {
    result = result.filter(a => a.priority === options.priority);
  }

  if (options?.unreadOnly) {
    result = result.filter(a => !a.read);
  }

  if (options?.limit) {
    result = result.slice(0, options.limit);
  }

  return result;
}

/**
 * Get unread count
 */
export function getUnreadCount(): number {
  return alerts.filter(a => !a.read && !a.dismissed).length;
}

/**
 * Get alerts by priority count
 */
export function getAlertCounts(): Record<AlertPriority, number> {
  const counts: Record<AlertPriority, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const alert of alerts) {
    if (!alert.dismissed) {
      counts[alert.priority]++;
    }
  }

  return counts;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Mark alert as read
 */
export function markAlertRead(alertId: string): boolean {
  const alert = alerts.find(a => a.alertId === alertId);
  if (alert) {
    alert.read = true;
    return true;
  }
  return false;
}

/**
 * Mark all alerts as read
 */
export function markAllAlertsRead(): number {
  let count = 0;
  for (const alert of alerts) {
    if (!alert.read) {
      alert.read = true;
      count++;
    }
  }
  return count;
}

/**
 * Dismiss alert
 */
export function dismissAlert(alertId: string): boolean {
  const alert = alerts.find(a => a.alertId === alertId);
  if (alert) {
    alert.dismissed = true;
    return true;
  }
  return false;
}

/**
 * Clear all alerts (for testing)
 */
export function clearAlerts(): void {
  alerts.length = 0;
}
