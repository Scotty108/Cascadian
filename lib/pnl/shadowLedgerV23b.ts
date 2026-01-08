/**
 * ============================================================================
 * SHADOW LEDGER PNL ENGINE - V23b [MARK-TO-MARKET UPGRADE]
 * ============================================================================
 *
 * STATUS: V23 UPGRADE WITH MARK-TO-MARKET OPTION
 * DATE: 2025-12-05
 * TERMINAL: Claude 1
 *
 * CHANGE FROM V23:
 * - V23: Uses $0.50 default for unresolved positions
 * - V23b: Uses LAST TRADE PRICE for unresolved positions (Mark-to-Market)
 *
 * PURPOSE:
 * The V23 diagnostic proved that 10 "UNKNOWN" wallets failed because they
 * held UNRESOLVED POSITIONS valued at $0.50 (default) instead of market price.
 * V23b fixes this by using the last traded price for unresolved markets.
 *
 * FORMULA:
 * - Resolved: PnL = cash_flow + (final_tokens * resolution_price)
 * - Unresolved: PnL = cash_flow + (final_tokens * last_trade_price)
 *
 * USAGE:
 * - calculateV23bPnL(wallet) - Uses Mark-to-Market (default)
 * - calculateV23bPnL(wallet, { markToMarket: false }) - Uses $0.50 default (V23 behavior)
 */

import { clickhouse } from '../clickhouse/client';
import {
  ShadowLedgerEngine,
  loadLedgerEventsForWallet,
  ShadowLedgerResult,
} from './shadowLedgerV23';

// ============================================================================
// Types
// ============================================================================

export interface V23bOptions {
  markToMarket?: boolean; // true = use last trade price, false = use $0.50 default
}

export interface V23bResult extends ShadowLedgerResult {
  markToMarketUsed: boolean;
  unresolvedConditions: number;
  lastPricesLoaded: number;
}

// ============================================================================
// Last Price Loader
// ============================================================================

/**
 * Load last trade prices for all conditions a wallet has traded.
 *
 * SIMPLIFIED APPROACH: Just use the wallet's own last trade as the price.
 * This avoids the expensive global join and is fast.
 *
 * Formula: last_price = abs(usdc_delta / token_delta) at max(event_time) for this wallet's trades
 */
async function loadLastTradePrices(
  wallet: string
): Promise<Map<string, number>> {
  // Simplified query - just get last trade price from wallet's own trades
  // This is fast because it only scans the wallet's events
  const query = `
    SELECT
      condition_id,
      outcome_index,
      argMax(abs(usdc_delta / nullIf(token_delta, 0)), event_time) as last_price
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = lower('${wallet}')
      AND source_type = 'CLOB'
      AND token_delta != 0
      AND condition_id IS NOT NULL
      AND condition_id != ''
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of rows) {
    const key = `${r.condition_id.toLowerCase()}|${r.outcome_index}`;
    const price = Number(r.last_price);
    if (!isNaN(price) && isFinite(price) && price >= 0 && price <= 1) {
      prices.set(key, price);
    }
  }

  return prices;
}

/**
 * Load resolution prices for all conditions this wallet has traded.
 * Returns a map of conditionId|outcomeIndex -> resolution_price
 */
async function loadResolutionPrices(
  wallet: string
): Promise<Map<string, number>> {
  const query = `
    WITH clob_conditions AS (
      SELECT DISTINCT m.condition_id
      FROM (
        SELECT token_id
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY token_id
      ) t
      INNER JOIN pm_token_to_condition_map_v4 m ON t.token_id = m.token_id_dec
    ),
    ctf_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
    ),
    wallet_conditions AS (
      SELECT condition_id FROM clob_conditions
      UNION ALL
      SELECT condition_id FROM ctf_conditions
    )
    SELECT DISTINCT
      r.condition_id,
      r.payout_numerators
    FROM pm_condition_resolutions r
    INNER JOIN (SELECT DISTINCT condition_id FROM wallet_conditions) wc
      ON lower(r.condition_id) = lower(wc.condition_id)
    WHERE r.is_deleted = 0
      AND r.payout_numerators IS NOT NULL
      AND r.payout_numerators != ''
      AND r.payout_numerators != '[]'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of rows) {
    const conditionId = r.condition_id.toLowerCase();
    const payoutNumerators = r.payout_numerators;

    try {
      const payouts = JSON.parse(payoutNumerators);
      if (Array.isArray(payouts)) {
        for (let i = 0; i < payouts.length; i++) {
          const key = `${conditionId}|${i}`;
          prices.set(key, Number(payouts[i]) || 0);
        }
      }
    } catch {
      // Skip malformed payout data
    }
  }

  return prices;
}

// ============================================================================
// V23b Engine
// ============================================================================

/**
 * Calculate PnL using V23b (Mark-to-Market) approach.
 *
 * @param wallet - Wallet address
 * @param options - { markToMarket: true } uses last trade price for unresolved
 * @returns V23bResult with PnL and diagnostic info
 */
export async function calculateV23bPnL(
  wallet: string,
  options: V23bOptions = { markToMarket: true }
): Promise<V23bResult> {
  const engine = new ShadowLedgerEngine();
  const events = await loadLedgerEventsForWallet(wallet);
  engine.processEvents(events);

  // Load resolution prices
  const resolutionPrices = await loadResolutionPrices(wallet);

  // Load last trade prices (only if markToMarket is enabled)
  let lastPrices = new Map<string, number>();
  if (options.markToMarket) {
    lastPrices = await loadLastTradePrices(wallet);
  }

  // Create a combined price oracle:
  // - If resolved: use resolution price
  // - If unresolved and markToMarket: use last trade price
  // - Otherwise: use $0.50 default
  const priceOracle = (conditionId: string, outcomeIndex: number): number => {
    const key = `${conditionId.toLowerCase()}|${outcomeIndex}`;

    // First, check resolution price
    const resPrice = resolutionPrices.get(key);
    if (resPrice !== undefined) {
      return resPrice;
    }

    // If markToMarket, use last trade price
    if (options.markToMarket) {
      const lastPrice = lastPrices.get(key);
      if (lastPrice !== undefined) {
        return lastPrice;
      }
    }

    // Default to $0.50
    return 0.5;
  };

  // Apply resolutions to positions
  engine.applyResolutions(wallet, resolutionPrices);

  // Get base result
  const baseResult = engine.getWalletResult(wallet, priceOracle);

  // Count unresolved conditions
  const positions = engine.getPositionDetails(wallet);
  let unresolvedConditions = 0;
  for (const pos of positions) {
    const key = `${pos.conditionId.toLowerCase()}|${pos.outcomeIndex}`;
    if (!resolutionPrices.has(key) && Math.abs(pos.quantity) > 0.01) {
      unresolvedConditions++;
    }
  }

  return {
    ...baseResult,
    markToMarketUsed: options.markToMarket ?? true,
    unresolvedConditions,
    lastPricesLoaded: lastPrices.size,
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Calculate V23b PnL with Mark-to-Market (default behavior)
 */
export async function calculateV23bMarkToMarket(
  wallet: string
): Promise<V23bResult> {
  return calculateV23bPnL(wallet, { markToMarket: true });
}

/**
 * Calculate V23b PnL with $0.50 default (V23 behavior)
 */
export async function calculateV23bDefault(wallet: string): Promise<V23bResult> {
  return calculateV23bPnL(wallet, { markToMarket: false });
}
