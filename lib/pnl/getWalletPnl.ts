/**
 * ============================================================================
 * CASCADIAN PNL SERVICE - Single Entry Point
 * ============================================================================
 *
 * This is the ONLY function the product should call for wallet PnL.
 * Internally delegates to CCR-v1 engine (Cost-basis Cascadian Realized).
 *
 * Usage:
 *   import { getWalletPnl } from '@/lib/pnl/getWalletPnl';
 *   const metrics = await getWalletPnl('0x...');
 *
 * Returns:
 *   - realized_pnl: PnL from resolved/settled markets
 *   - unrealized_pnl: Estimated PnL at 0.5 mark price for open positions
 *   - total_pnl: Sum of realized + unrealized
 *   - Plus additional metrics (win_rate, volume, etc.)
 *
 * Engine: CCR-v1 (Polymarket subgraph-style cost basis)
 * Data Source: pm_trader_events_v2 (CLOB trades, deduped by event_id)
 *
 * Accuracy: ~2% vs Polymarket UI for CLOB-only wallets
 *
 * ============================================================================
 */

import { computeCCRv1, CCRMetrics } from './ccrEngineV1';

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
 * @returns Full metrics including win_rate, volume, etc.
 */
export async function getWalletPnl(wallet: string): Promise<WalletPnL> {
  const metrics = await computeCCRv1(wallet);

  // Calculate omega ratio from win/loss counts
  // omega = gains / losses (simplified)
  const omega_ratio = metrics.loss_count > 0
    ? metrics.win_count / metrics.loss_count
    : metrics.win_count > 0 ? 100 : 1;

  return {
    wallet: metrics.wallet,
    realized_pnl: metrics.realized_pnl,
    unrealized_pnl: metrics.unrealized_pnl,
    total_pnl: metrics.total_pnl,
    total_gain: 0, // CCR-v1 tracks win_count, not gain amount (TODO: add if needed)
    total_loss: 0, // CCR-v1 tracks loss_count, not loss amount (TODO: add if needed)
    volume_traded: metrics.volume_traded,
    total_trades: metrics.total_trades,
    positions_count: metrics.positions_count,
    markets_traded: metrics.positions_count, // Same as positions for now
    resolutions: metrics.resolved_count,
    win_rate: metrics.win_rate,
    omega_ratio,
    sharpe_ratio: null, // TODO: add to CCR-v1 if needed
    sortino_ratio: null, // TODO: add to CCR-v1 if needed
  };
}

/**
 * Get quick wallet PnL (just the core PnL numbers)
 *
 * Use this for bulk operations, benchmarking, or when you just need PnL values.
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns Core PnL values only
 */
export async function getWalletPnlQuick(wallet: string): Promise<WalletPnLQuick> {
  const result = await computeCCRv1(wallet);

  return {
    wallet,
    total_pnl: result.total_pnl,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    positions: result.positions_count,
    resolved: result.resolved_count,
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
    tier: 'retail', // CCR-v1 doesn't distinguish tiers
    confidence: 'high',
    engine: 'v20', // Keep as v20 for backwards compat (TODO: add 'ccr' to type)
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
export type { CCRMetrics };
