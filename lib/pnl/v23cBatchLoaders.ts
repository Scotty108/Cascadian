/**
 * ============================================================================
 * V23C BATCH LOADERS
 * ============================================================================
 *
 * Optimized batch data loaders for V23C PnL engine to eliminate per-wallet
 * ClickHouse round-trips and enable fast head-to-head testing vs V29.
 *
 * PATTERN: Mirrors v29BatchLoaders.ts
 *
 * Terminal: Claude 2
 * Date: 2025-12-06
 */

import { clickhouse } from '../clickhouse/client';
import { LedgerEvent } from './shadowLedgerV23';

// Use same table as V29 for consistency
const UNIFIED_LEDGER_TABLE = 'pm_unified_ledger_v8_tbl';

// ============================================================================
// Types
// ============================================================================

export interface V23cPreloadData {
  eventsByWallet: Map<string, LedgerEvent[]>;
  resolutionPrices: Map<string, number>; // key format: "condition_id|outcome_index"
  uiPrices: Map<string, number>; // key format: "condition_id|outcome_index"
  stats: {
    walletsLoaded: number;
    totalEvents: number;
    conditionsWithResolutions: number;
    conditionsWithUIPrices: number;
    loadTimeMs: number;
  };
}

// ============================================================================
// Event Batch Loader
// ============================================================================

/**
 * Load ledger events for multiple wallets in a single query
 */
export async function loadV23cEventsBatch(wallets: string[]): Promise<Map<string, LedgerEvent[]>> {
  const startTime = Date.now();
  console.log(`🔄 [V23C] Batch loading events for ${wallets.length} wallets...`);

  if (wallets.length === 0) {
    return new Map();
  }

  // Normalize wallets to lowercase
  const normalizedWallets = wallets.map(w => w.toLowerCase());

  const query = `
    SELECT
      source_type,
      lower(wallet_address) as wallet_address,
      lower(condition_id) as condition_id,
      outcome_index,
      event_time,
      event_id,
      usdc_delta,
      token_delta,
      payout_norm
    FROM ${UNIFIED_LEDGER_TABLE}
    WHERE lower(wallet_address) IN ({wallets:Array(String)})
      AND condition_id IS NOT NULL
      AND condition_id != ''
    ORDER BY wallet_address, event_time ASC
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallets: normalizedWallets },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];

  // Group events by wallet
  const eventsByWallet = new Map<string, LedgerEvent[]>();

  for (const wallet of normalizedWallets) {
    eventsByWallet.set(wallet, []);
  }

  for (const r of rows) {
    const wallet = r.wallet_address?.toLowerCase();
    if (!wallet) continue;

    const event: LedgerEvent = {
      source_type: r.source_type,
      wallet_address: wallet,
      condition_id: r.condition_id?.toLowerCase() || '',
      outcome_index: Number(r.outcome_index) || 0,
      event_time: new Date(r.event_time),
      event_id: r.event_id,
      usdc_delta: Number(r.usdc_delta) || 0,
      token_delta: Number(r.token_delta) || 0,
      payout_norm: r.payout_norm !== null ? Number(r.payout_norm) : null,
    };

    const walletEvents = eventsByWallet.get(wallet);
    if (walletEvents) {
      walletEvents.push(event);
    }
  }

  const duration = Date.now() - startTime;
  const totalEvents = rows.length;
  console.log(
    `✅ [V23C] Batch loaded ${totalEvents.toLocaleString()} events in ${duration}ms (avg ${(totalEvents / wallets.length).toFixed(0)} events/wallet)`
  );

  return eventsByWallet;
}

// ============================================================================
// Resolution Prices Batch Loader
// ============================================================================

/**
 * Load resolution prices for a set of condition IDs
 * Returns Map<"condition_id|outcome_index", price>
 */
export async function loadV23cResolutionPricesBatch(
  conditionIds: string[]
): Promise<Map<string, number>> {
  const startTime = Date.now();
  console.log(`🔄 [V23C] Batch loading resolution prices for ${conditionIds.length} conditions...`);

  if (conditionIds.length === 0) {
    return new Map();
  }

  // Normalize to lowercase and dedupe
  const normalizedConditions = [...new Set(conditionIds.map(c => c.toLowerCase()))];

  const pricesMap = new Map<string, number>();

  // Batch to avoid query size limits
  // Reduced from 2000 to 500 to avoid "Field value too long" errors
  const BATCH_SIZE = 500;

  for (let i = 0; i < normalizedConditions.length; i += BATCH_SIZE) {
    const batch = normalizedConditions.slice(i, i + BATCH_SIZE);

    const query = `
      SELECT
        lower(condition_id) as condition_id,
        payout_numerators
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN ({conditions:Array(String)})
        AND is_deleted = 0
        AND payout_numerators IS NOT NULL
        AND payout_numerators != ''
        AND payout_numerators != '[]'
    `;

    try {
      const result = await clickhouse.query({
        query,
        query_params: { conditions: batch },
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as any[];

      for (const r of rows) {
        if (!r.condition_id) continue;

        const conditionId = r.condition_id.toLowerCase();
        const payoutNumerators = r.payout_numerators;

        try {
          const payouts = JSON.parse(payoutNumerators);
          if (Array.isArray(payouts)) {
            for (let outcomeIdx = 0; outcomeIdx < payouts.length; outcomeIdx++) {
              const key = `${conditionId}|${outcomeIdx}`;
              pricesMap.set(key, Number(payouts[outcomeIdx]) || 0);
            }
          }
        } catch {
          // Skip malformed payout data
        }
      }
    } catch (err) {
      console.error(`⚠️  [V23C] Error loading resolution prices for batch ${i / BATCH_SIZE + 1}:`, err);
      // Continue with other batches
    }
  }

  const duration = Date.now() - startTime;
  const conditionsWithPrices = new Set(
    Array.from(pricesMap.keys()).map(k => k.split('|')[0])
  ).size;

  console.log(
    `✅ [V23C] Batch loaded resolution prices in ${duration}ms (${conditionsWithPrices} conditions resolved)`
  );

  return pricesMap;
}

// ============================================================================
// UI Prices Batch Loader
// ============================================================================

/**
 * Load UI prices from pm_market_metadata for a set of condition IDs
 * Returns Map<"condition_id|outcome_index", price>
 */
export async function loadV23cUIPricesBatch(conditionIds: string[]): Promise<Map<string, number>> {
  const startTime = Date.now();
  console.log(`🔄 [V23C] Batch loading UI prices for ${conditionIds.length} conditions...`);

  if (conditionIds.length === 0) {
    return new Map();
  }

  // Normalize to lowercase and dedupe
  const normalizedConditions = [...new Set(conditionIds.map(c => c.toLowerCase()))];

  const pricesMap = new Map<string, number>();

  // Batch to avoid query size limits
  // Reduced from 2000 to 500 to avoid "Field value too long" errors
  const BATCH_SIZE = 500;

  for (let i = 0; i < normalizedConditions.length; i += BATCH_SIZE) {
    const batch = normalizedConditions.slice(i, i + BATCH_SIZE);

    const query = `
      SELECT
        lower(condition_id) as condition_id,
        outcome_prices
      FROM pm_market_metadata
      WHERE lower(condition_id) IN ({conditions:Array(String)})
        AND outcome_prices IS NOT NULL
        AND outcome_prices != ''
        AND outcome_prices != '[]'
    `;

    try {
      const result = await clickhouse.query({
        query,
        query_params: { conditions: batch },
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as any[];

      for (const r of rows) {
        if (!r.condition_id) continue;

        const conditionId = r.condition_id.toLowerCase();
        let priceStr = r.outcome_prices;

        try {
          // Handle double-escaped JSON: "[\"0.385\", \"0.614\"]"
          if (priceStr.startsWith('"') && priceStr.endsWith('"')) {
            priceStr = priceStr.slice(1, -1);
          }
          // Unescape inner quotes
          priceStr = priceStr.replace(/\\"/g, '"');

          const priceArray = JSON.parse(priceStr);

          if (Array.isArray(priceArray)) {
            for (let outcomeIdx = 0; outcomeIdx < priceArray.length; outcomeIdx++) {
              const price = Number(priceArray[outcomeIdx]);
              if (!isNaN(price) && isFinite(price) && price >= 0 && price <= 1) {
                const key = `${conditionId}|${outcomeIdx}`;
                pricesMap.set(key, price);
              }
            }
          }
        } catch {
          // Skip malformed price data
        }
      }
    } catch (err) {
      console.error(`⚠️  [V23C] Error loading UI prices for batch ${i / BATCH_SIZE + 1}:`, err);
      // Continue with other batches
    }
  }

  const duration = Date.now() - startTime;
  const conditionsWithPrices = new Set(
    Array.from(pricesMap.keys()).map(k => k.split('|')[0])
  ).size;

  console.log(
    `✅ [V23C] Batch loaded UI prices in ${duration}ms (${conditionsWithPrices} conditions with prices)`
  );

  return pricesMap;
}

// ============================================================================
// Main Preload Function
// ============================================================================

/**
 * Preload all data needed for V23C calculation for multiple wallets
 * This is the main entry point for batch validation
 */
export async function preloadV23cData(wallets: string[]): Promise<V23cPreloadData> {
  const startTime = Date.now();

  console.log(`\n🚀 [V23C] Preloading data for ${wallets.length} wallets...\n`);

  // Load all events
  const eventsByWallet = await loadV23cEventsBatch(wallets);

  // Extract all unique condition IDs across all wallets
  const conditionIds = new Set<string>();
  for (const events of eventsByWallet.values()) {
    for (const event of events) {
      if (event.condition_id) {
        conditionIds.add(event.condition_id);
      }
    }
  }

  console.log(`📊 [V23C] Found ${conditionIds.size} unique conditions across all wallets\n`);

  // Load resolution prices and UI prices in parallel
  const [resolutionPrices, uiPrices] = await Promise.all([
    loadV23cResolutionPricesBatch([...conditionIds]),
    loadV23cUIPricesBatch([...conditionIds]),
  ]);

  const totalEvents = Array.from(eventsByWallet.values()).reduce(
    (sum, events) => sum + events.length,
    0
  );
  const loadTimeMs = Date.now() - startTime;

  const conditionsWithResolutions = new Set(
    Array.from(resolutionPrices.keys()).map(k => k.split('|')[0])
  ).size;

  const conditionsWithUIPrices = new Set(
    Array.from(uiPrices.keys()).map(k => k.split('|')[0])
  ).size;

  console.log(`\n✅ [V23C] Preload complete in ${loadTimeMs}ms`);
  console.log(`   Total events: ${totalEvents.toLocaleString()}`);
  console.log(`   Conditions with resolutions: ${conditionsWithResolutions}`);
  console.log(`   Conditions with UI prices: ${conditionsWithUIPrices}\n`);

  return {
    eventsByWallet,
    resolutionPrices,
    uiPrices,
    stats: {
      walletsLoaded: wallets.length,
      totalEvents,
      conditionsWithResolutions,
      conditionsWithUIPrices,
      loadTimeMs,
    },
  };
}
