/**
 * ============================================================================
 * CASCADIAN PNL SERVICE - Single Entry Point
 * ============================================================================
 *
 * This is the ONLY function the product should call for wallet PnL.
 * Internally delegates to V20 engine (the canonical PnL engine).
 *
 * Usage:
 *   import { getWalletPnl } from '@/lib/pnl/getWalletPnl';
 *   const metrics = await getWalletPnl('0x...');
 *
 * Returns:
 *   - realized_pnl: PnL from resolved/settled markets
 *   - unrealized_pnl: Estimated PnL at 0.5 mark price for open positions
 *   - total_pnl: Sum of realized + unrealized
 *   - Plus additional metrics (win_rate, omega_ratio, etc.)
 *
 * Data Source: pm_unified_ledger_v7 (CLOB trades only)
 *
 * Accuracy: Validated to 0.01-2% vs Polymarket UI for top leaderboard wallets
 *
 * ============================================================================
 */

import { createV20Engine, WalletMetricsV20, calculateV20PnL } from './uiActivityEngineV20';

export interface WalletPnL {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  total_trades: number;
  positions_count: number;
  markets_traded: number;
  resolutions: number;
  win_rate: number;
  omega_ratio: number;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
}

export interface WalletPnLQuick {
  wallet: string;
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: number;
  resolved: number;
}

// Legacy interface for backwards compatibility
export interface WalletPnlResult {
  wallet: string;
  pnl: number;
  tier: 'retail' | 'mixed' | 'operator';
  confidence: 'high' | 'medium' | 'low';
  engine: 'v20' | 'ledger' | 'v11_poly' | 'unsupported';
  warning?: string;
}

/**
 * Get full wallet PnL metrics (includes all derived metrics)
 *
 * Use this for dashboard displays, leaderboard, detailed wallet views.
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns Full metrics including win_rate, omega_ratio, sharpe_ratio, etc.
 */
export async function getWalletPnl(wallet: string): Promise<WalletPnL> {
  const engine = createV20Engine();
  const metrics = await engine.compute(wallet);

  return {
    wallet: metrics.wallet,
    realized_pnl: metrics.realized_pnl,
    unrealized_pnl: metrics.unrealized_pnl,
    total_pnl: metrics.total_pnl,
    total_gain: metrics.total_gain,
    total_loss: metrics.total_loss,
    volume_traded: metrics.volume_traded,
    total_trades: metrics.total_trades,
    positions_count: metrics.positions_count,
    markets_traded: metrics.markets_traded,
    resolutions: metrics.resolutions,
    win_rate: metrics.win_rate,
    omega_ratio: metrics.omega_ratio,
    sharpe_ratio: metrics.sharpe_ratio,
    sortino_ratio: metrics.sortino_ratio,
  };
}

/**
 * Get quick wallet PnL (just the core PnL numbers)
 *
 * Use this for bulk operations, benchmarking, or when you just need PnL values.
 * Faster than getWalletPnl() as it skips derived metric calculations.
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns Core PnL values only
 */
export async function getWalletPnlQuick(wallet: string): Promise<WalletPnLQuick> {
  const result = await calculateV20PnL(wallet);

  return {
    wallet,
    total_pnl: result.total_pnl,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    positions: result.positions,
    resolved: result.resolved,
  };
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use getWalletPnl() instead
 */
export async function getWalletPnlLegacy(wallet: string): Promise<WalletPnlResult> {
  const metrics = await getWalletPnl(wallet);

  return {
    wallet,
    pnl: metrics.total_pnl,
    tier: 'retail', // V20 doesn't distinguish tiers
    confidence: 'high',
    engine: 'v20',
  };
}

/**
 * Get PnL for multiple wallets (batch operation)
 *
 * Processes wallets in parallel for efficiency.
 *
 * @param wallets - Array of wallet addresses
 * @param concurrency - Max concurrent requests (default: 5)
 * @returns Array of wallet PnL results
 */
export async function getWalletPnlBatch(
  wallets: string[],
  concurrency: number = 5
): Promise<WalletPnLQuick[]> {
  const results: WalletPnLQuick[] = [];

  // Process in batches
  for (let i = 0; i < wallets.length; i += concurrency) {
    const batch = wallets.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((w) => getWalletPnlQuick(w)));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Get PnL for multiple wallets (legacy interface)
 * @deprecated Use getWalletPnlBatch() instead
 */
export async function getWalletsPnl(wallets: string[]): Promise<WalletPnlResult[]> {
  const results: WalletPnlResult[] = [];
  for (const wallet of wallets) {
    try {
      const result = await getWalletPnlLegacy(wallet);
      results.push(result);
    } catch (e: unknown) {
      results.push({
        wallet,
        pnl: 0,
        tier: 'retail',
        confidence: 'low',
        engine: 'unsupported',
        warning: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }
  return results;
}

/**
 * Format PnL for display
 */
export function formatPnl(pnl: number): string {
  const sign = pnl < 0 ? '-' : '+';
  const abs = Math.abs(pnl);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(2)}`;
  }
}

// Re-export types for convenience
export type { WalletMetricsV20 };
