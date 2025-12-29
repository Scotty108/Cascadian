/**
 * Copy Trade Execution Adapter
 *
 * Abstraction layer for copy trade execution.
 * V1 uses DryRunAdapter (simulation only).
 * Live execution requires ENABLE_LIVE_COPY_TRADE=true and is safely stubbed.
 */

export interface CopyTradeExecutionRequest {
  conditionId: string;
  marketId: string;
  side: "buy" | "sell";
  outcome: string;
  price: number;
  size: number;
  maxCopyPerTradeUsd?: number;
}

export interface CopyTradeExecutionResult {
  status: "executed" | "simulated" | "skipped" | "error";
  txHash?: string | null;
  reason?: string;
  errorMessage?: string | null;
  simulatedAt?: string;
}

export interface CopyTradeExecutionAdapter {
  execute(req: CopyTradeExecutionRequest): Promise<CopyTradeExecutionResult>;
}

/**
 * DryRunAdapter - Default adapter for V1
 * Always returns simulated status, never executes real trades.
 */
export class DryRunAdapter implements CopyTradeExecutionAdapter {
  async execute(req: CopyTradeExecutionRequest): Promise<CopyTradeExecutionResult> {
    // Validate max copy amount if specified
    const notional = req.price * req.size;
    if (req.maxCopyPerTradeUsd && notional > req.maxCopyPerTradeUsd) {
      return {
        status: "skipped",
        txHash: null,
        reason: `notional_exceeds_max: ${notional.toFixed(2)} > ${req.maxCopyPerTradeUsd}`,
        simulatedAt: new Date().toISOString(),
      };
    }

    return {
      status: "simulated",
      txHash: null,
      reason: "dry_run_mode",
      simulatedAt: new Date().toISOString(),
    };
  }
}

/**
 * LiveAdapter - Placeholder for future live execution
 * Refuses to execute unless ENABLE_LIVE_COPY_TRADE=true
 * Even then, safely stubbed until real signer is configured.
 */
export class LiveAdapter implements CopyTradeExecutionAdapter {
  async execute(req: CopyTradeExecutionRequest): Promise<CopyTradeExecutionResult> {
    // Hard gate on environment variable
    if (process.env.ENABLE_LIVE_COPY_TRADE !== "true") {
      return {
        status: "skipped",
        txHash: null,
        reason: "live_execution_disabled",
      };
    }

    // Even with flag enabled, we don't have a real signer yet
    // This is where you'd integrate with a wallet/signing service

    // Validate max copy amount
    const notional = req.price * req.size;
    if (req.maxCopyPerTradeUsd && notional > req.maxCopyPerTradeUsd) {
      return {
        status: "skipped",
        txHash: null,
        reason: `notional_exceeds_max: ${notional.toFixed(2)} > ${req.maxCopyPerTradeUsd}`,
      };
    }

    // Safe stub - would need real implementation
    return {
      status: "skipped",
      txHash: null,
      reason: "live_adapter_not_configured",
    };
  }
}

/**
 * Get the appropriate execution adapter based on config
 */
export function getExecutionAdapter(dryRun: boolean): CopyTradeExecutionAdapter {
  if (dryRun) {
    return new DryRunAdapter();
  }
  return new LiveAdapter();
}
