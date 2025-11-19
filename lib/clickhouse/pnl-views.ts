/**
 * PnL View Helper - Feature Flag for V2/V3 Selection
 *
 * Provides centralized control over which PnL view (V2 or V3) is used across the app
 * Default: V2 (stable, production-tested)
 * Rollout: Set ENABLE_V3_PNL_VIEWS=true in .env.local to enable V3
 *
 * Rollback: Change env var back to false or remove it (instant, zero downtime)
 */

/**
 * Get PnL view name based on feature flag
 *
 * @returns View name: 'pm_wallet_market_pnl_v2' (default) or 'vw_wallet_market_pnl_v3' (when flag enabled)
 */
export function getPnLViewName(): string {
  const enableV3 = process.env.ENABLE_V3_PNL_VIEWS === 'true';

  if (enableV3) {
    console.log('[PnL View] Using V3: vw_wallet_market_pnl_v3');
    return 'vw_wallet_market_pnl_v3';
  }

  console.log('[PnL View] Using V2: pm_wallet_market_pnl_v2 (default)');
  return 'pm_wallet_market_pnl_v2';
}

/**
 * Get PnL trade source view based on feature flag
 *
 * @returns View name: 'pm_trades_canonical_v2' (default) or 'vw_trades_canonical_current' (when flag enabled)
 */
export function getPnLTradeSourceName(): string {
  const enableV3 = process.env.ENABLE_V3_PNL_VIEWS === 'true';

  if (enableV3) {
    console.log('[Trade Source] Using V3: vw_trades_canonical_current');
    return 'vw_trades_canonical_current';
  }

  console.log('[Trade Source] Using V2: pm_trades_canonical_v2 (default)');
  return 'pm_trades_canonical_v2';
}

/**
 * Check if V3 PnL views are enabled
 *
 * @returns true if V3 is enabled, false otherwise (V2 default)
 */
export function isV3PnLEnabled(): boolean {
  return process.env.ENABLE_V3_PNL_VIEWS === 'true';
}

/**
 * Get current PnL version for logging/debugging
 *
 * @returns 'v2' or 'v3'
 */
export function getPnLVersion(): 'v2' | 'v3' {
  return isV3PnLEnabled() ? 'v3' : 'v2';
}

/**
 * Example usage in API routes:
 *
 * ```typescript
 * import { getPnLViewName } from '@/lib/clickhouse/pnl-views';
 *
 * const pnlView = getPnLViewName(); // Returns 'pm_wallet_market_pnl_v2' or 'vw_wallet_market_pnl_v3'
 *
 * const query = `
 *   SELECT
 *     wallet_address,
 *     realized_pnl_usd,
 *     total_trades
 *   FROM ${pnlView}
 *   WHERE wallet_address = {wallet:String}
 * `;
 * ```
 *
 * Rollback:
 * 1. Remove ENABLE_V3_PNL_VIEWS from .env.local
 * 2. Restart Next.js server
 * 3. App instantly reverts to V2 (zero downtime)
 */
