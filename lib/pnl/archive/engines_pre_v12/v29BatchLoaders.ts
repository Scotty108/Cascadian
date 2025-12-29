/**
 * Batch loaders for V29 PnL engine
 *
 * Optimized for validating multiple wallets by pre-loading all data in batched queries.
 * This eliminates per-wallet ClickHouse round-trips.
 */

import { clickhouse } from '../../../clickhouse/client';
import { V29Event } from './inventoryEngineV29';
import { getLedgerTable, LedgerSource } from './dataSourceConstants';

// Default ledger table - use the centralized constant
const DEFAULT_LEDGER_SOURCE: LedgerSource = 'v8_unified';

export interface V29PreloadData {
  eventsByWallet: Map<string, V29Event[]>;
  resolutionPrices: Map<string, Map<number, number>>;
  stats: {
    walletsLoaded: number;
    totalEvents: number;
    conditionsWithPrices: number;
    loadTimeMs: number;
  };
}

export interface V29LoaderOptions {
  ledgerSource?: LedgerSource;
}

/**
 * Load events for multiple wallets in a single query
 *
 * @param wallets - Array of wallet addresses
 * @param options - Optional configuration including ledger source
 *   - ledgerSource: 'v8_unified' (default) or 'v9_clob_only'
 */
export async function loadV29EventsBatch(
  wallets: string[],
  options: V29LoaderOptions = {}
): Promise<Map<string, V29Event[]>> {
  const { ledgerSource = DEFAULT_LEDGER_SOURCE } = options;
  const tableName = getLedgerTable(ledgerSource);

  const startTime = Date.now();
  console.log(`🔄 Batch loading events for ${wallets.length} wallets from ${tableName}...`);

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
    FROM ${tableName}
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
  const eventsByWallet = new Map<string, V29Event[]>();

  for (const wallet of normalizedWallets) {
    eventsByWallet.set(wallet, []);
  }

  for (const r of rows) {
    const wallet = r.wallet_address?.toLowerCase();
    if (!wallet) continue;

    const event: V29Event = {
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
  console.log(`✅ Batch loaded ${totalEvents.toLocaleString()} events in ${duration}ms (avg ${(totalEvents / wallets.length).toFixed(0)} events/wallet)`);

  return eventsByWallet;
}

/**
 * Load resolution prices for a set of condition IDs
 * This is wallet-independent and can be cached
 */
export async function loadV29ResolutionPricesBatch(
  conditionIds: string[]
): Promise<Map<string, Map<number, number>>> {
  const startTime = Date.now();
  console.log(`🔄 Batch loading resolution prices for ${conditionIds.length} conditions...`);

  if (conditionIds.length === 0) {
    return new Map();
  }

  // Normalize to lowercase
  const normalizedConditions = [...new Set(conditionIds.map(c => c.toLowerCase()))];

  const pricesMap = new Map<string, Map<number, number>>();

  // Batch to avoid query size limits
  // Reduced from 2000 to 500 to avoid "Field value too long" errors
  const BATCH_SIZE = 500;

  for (let i = 0; i < normalizedConditions.length; i += BATCH_SIZE) {
    const batch = normalizedConditions.slice(i, i + BATCH_SIZE);

    const query = `
      SELECT
        lower(condition_id) as condition_id,
        outcome_index,
        resolved_price
      FROM vw_pm_resolution_prices
      WHERE lower(condition_id) IN ({conditions:Array(String)})
        AND resolved_price IS NOT NULL
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
        const outcomeIndex = Number(r.outcome_index);
        const price = Number(r.resolved_price);

        if (!isNaN(price)) {
          if (!pricesMap.has(conditionId)) {
            pricesMap.set(conditionId, new Map());
          }
          pricesMap.get(conditionId)!.set(outcomeIndex, price);
        }
      }
    } catch (err) {
      console.error(`⚠️  Error loading resolution prices for batch ${i / BATCH_SIZE + 1}:`, err);
      // Continue with other batches
    }
  }

  const duration = Date.now() - startTime;
  console.log(`✅ Batch loaded resolution prices in ${duration}ms (${pricesMap.size} conditions resolved)`);

  return pricesMap;
}

/**
 * Preload all data needed for V29 calculation for multiple wallets
 * This is the main entry point for batch validation
 *
 * @param wallets - Array of wallet addresses
 * @param options - Optional configuration including ledger source
 *   - ledgerSource: 'v8_unified' (default) or 'v9_clob_only'
 */
export async function preloadV29Data(
  wallets: string[],
  options: V29LoaderOptions = {}
): Promise<V29PreloadData> {
  const { ledgerSource = DEFAULT_LEDGER_SOURCE } = options;
  const startTime = Date.now();

  console.log(`\n🚀 Preloading V29 data for ${wallets.length} wallets (ledger: ${ledgerSource})...\n`);

  // Load all events
  const eventsByWallet = await loadV29EventsBatch(wallets, { ledgerSource });

  // Extract all unique condition IDs across all wallets
  const conditionIds = new Set<string>();
  for (const events of eventsByWallet.values()) {
    for (const event of events) {
      if (event.condition_id) {
        conditionIds.add(event.condition_id);
      }
    }
  }

  console.log(`📊 Found ${conditionIds.size} unique conditions across all wallets\n`);

  // Load resolution prices for all conditions
  const resolutionPrices = await loadV29ResolutionPricesBatch([...conditionIds]);

  const totalEvents = Array.from(eventsByWallet.values()).reduce((sum, events) => sum + events.length, 0);
  const loadTimeMs = Date.now() - startTime;

  console.log(`\n✅ Preload complete in ${loadTimeMs}ms`);
  console.log(`   Total events: ${totalEvents.toLocaleString()}`);
  console.log(`   Conditions with prices: ${resolutionPrices.size}\n`);

  return {
    eventsByWallet,
    resolutionPrices,
    stats: {
      walletsLoaded: wallets.length,
      totalEvents,
      conditionsWithPrices: resolutionPrices.size,
      loadTimeMs
    }
  };
}
