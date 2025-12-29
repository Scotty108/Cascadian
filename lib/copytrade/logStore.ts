/**
 * Copy Trade Log Store
 *
 * In-memory ring buffer for copy trade decisions.
 * V1 is memory-only; can add ClickHouse persistence later.
 */

import type { CopyTradeDecision } from "@/lib/contracts/strategyBuilder";

const MAX_LOG_SIZE = 1000;
const logs: CopyTradeDecision[] = [];

/**
 * Add a decision to the log store
 */
export function addDecision(decision: CopyTradeDecision): void {
  logs.unshift(decision); // newest first
  if (logs.length > MAX_LOG_SIZE) {
    logs.pop(); // remove oldest
  }
}

/**
 * Get recent decisions
 */
export function getDecisions(options: {
  limit?: number;
  status?: CopyTradeDecision["status"];
  wallet?: string;
  conditionId?: string;
} = {}): CopyTradeDecision[] {
  let result = [...logs];

  // Filter by status
  if (options.status) {
    result = result.filter(d => d.status === options.status);
  }

  // Filter by source wallet
  if (options.wallet) {
    const walletLower = options.wallet.toLowerCase();
    result = result.filter(d =>
      d.sourceWallet.toLowerCase() === walletLower ||
      d.matchedWallets.some(w => w.toLowerCase() === walletLower)
    );
  }

  // Filter by condition
  if (options.conditionId) {
    result = result.filter(d => d.conditionId === options.conditionId);
  }

  // Apply limit
  const limit = options.limit || 100;
  return result.slice(0, limit);
}

/**
 * Get log stats
 */
export function getLogStats(): {
  total: number;
  byStatus: Record<CopyTradeDecision["status"], number>;
  oldestTimestamp?: string;
  newestTimestamp?: string;
} {
  const byStatus: Record<CopyTradeDecision["status"], number> = {
    executed: 0,
    simulated: 0,
    skipped: 0,
    filtered: 0,
    error: 0,
  };

  for (const decision of logs) {
    byStatus[decision.status]++;
  }

  return {
    total: logs.length,
    byStatus,
    oldestTimestamp: logs.length > 0 ? logs[logs.length - 1].timestamp : undefined,
    newestTimestamp: logs.length > 0 ? logs[0].timestamp : undefined,
  };
}

/**
 * Clear all logs (for testing)
 */
export function clearLogs(): void {
  logs.length = 0;
}

/**
 * Get decision by ID
 */
export function getDecisionById(decisionId: string): CopyTradeDecision | undefined {
  return logs.find(d => d.decisionId === decisionId);
}
