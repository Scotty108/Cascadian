/**
 * ============================================================================
 * SHADOW LEDGER PNL ENGINE - V23c [UI PRICE ORACLE]
 * ============================================================================
 *
 * STATUS: V23 UPGRADE WITH UI PRICE ORACLE
 * DATE: 2025-12-05
 * TERMINAL: Claude 1
 *
 * CHANGE FROM V23b:
 * - V23b: Uses last_trade_price (wallet's own last trade)
 * - V23c: Uses pm_market_metadata.outcome_prices (SAME AS UI)
 *
 * PURPOSE:
 * The V23b "regression" proved that last_trade_price differs from the UI's
 * price oracle. The UI uses pm_market_metadata.outcome_prices for live market
 * prices. V23c uses this same source to achieve 100% accuracy.
 *
 * PRICE ORACLE PRIORITY:
 * 1. Resolution price (if market resolved) - from pm_condition_resolutions
 * 2. UI prices (pm_market_metadata.outcome_prices) - for unresolved markets
 * 3. Last trade price - fallback
 * 4. $0.50 default - final fallback
 *
 * FORMULA:
 * - Resolved: PnL = cash_flow + (final_tokens * resolution_price)
 * - Unresolved: PnL = cash_flow + (final_tokens * outcome_price_from_metadata)
 */

import { clickhouse } from '../clickhouse/client';
import {
  ShadowLedgerEngine,
  loadLedgerEventsForWallet,
  ShadowLedgerResult,
  LedgerEvent,
} from './shadowLedgerV23';

// ============================================================================
// Types
// ============================================================================

export interface V23cPreload {
  events: LedgerEvent[];
  resolutionPrices: Map<string, number>; // key format: "condition_id|outcome_index"
  uiPrices: Map<string, number>; // key format: "condition_id|outcome_index"
}

export interface V23cOptions {
  useUIOracle?: boolean; // true = use pm_market_metadata.outcome_prices, false = use last_trade_price
  preload?: V23cPreload; // NEW: Skip ClickHouse queries if provided
}

export interface V23cResult extends ShadowLedgerResult {
  uiOracleUsed: boolean;
  unresolvedConditions: number;
  uiPricesLoaded: number;
  lastPricesLoaded: number;
}

// ============================================================================
// UI Price Oracle Loader
// ============================================================================

/**
 * Load UI prices from pm_market_metadata.outcome_prices for all conditions
 * a wallet has traded.
 *
 * The outcome_prices field is a JSON array of prices for each outcome index.
 * Format: "[\"0.385...\", \"0.614...\"]" (double-escaped JSON)
 */
async function loadUIMarketPrices(wallet: string): Promise<Map<string, number>> {
  // Step 1: Get all condition_ids this wallet has traded
  const conditionsQuery = `
    SELECT DISTINCT condition_id
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  const condResult = await clickhouse.query({ query: conditionsQuery, format: 'JSONEachRow' });
  const condRows = (await condResult.json()) as any[];

  if (condRows.length === 0) {
    return new Map();
  }

  // Step 2: Get outcome_prices from pm_market_metadata for these conditions
  // Use a subquery to avoid query size limits with large IN clauses
  const metaQuery = `
    SELECT
      lower(condition_id) as condition_id,
      outcome_prices
    FROM pm_market_metadata
    WHERE condition_id IN (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
    )
    AND outcome_prices IS NOT NULL
    AND outcome_prices != ''
    AND outcome_prices != '[]'
  `;

  const metaResult = await clickhouse.query({ query: metaQuery, format: 'JSONEachRow' });
  const metaRows = (await metaResult.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of metaRows) {
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
        for (let i = 0; i < priceArray.length; i++) {
          const key = `${conditionId}|${i}`;
          const price = Number(priceArray[i]);
          if (!isNaN(price) && isFinite(price) && price >= 0 && price <= 1) {
            prices.set(key, price);
          }
        }
      }
    } catch {
      // Skip malformed price data
    }
  }

  return prices;
}

/**
 * Load last trade prices from wallet's own trades (fallback)
 */
async function loadLastTradePrices(wallet: string): Promise<Map<string, number>> {
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
 */
async function loadResolutionPrices(wallet: string): Promise<Map<string, number>> {
  const query = `
    WITH wallet_conditions AS (
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v7
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id IS NOT NULL
        AND condition_id != ''
    )
    SELECT DISTINCT
      lower(r.condition_id) as condition_id,
      r.payout_numerators
    FROM pm_condition_resolutions r
    INNER JOIN wallet_conditions wc
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
// Raw Trades Fallback Loader (V23c Direct)
// ============================================================================

/**
 * Load trades directly from pm_trader_events_v2, bypassing the stale unified ledger.
 * Maps token_id -> condition_id via pm_market_metadata.
 *
 * This is the "bypass surgery" for wallets whose trades aren't in pm_unified_ledger_v7
 * because the ledger's mapping table is stale.
 */
async function loadRawTradesFallback(wallet: string): Promise<LedgerEvent[]> {
  // Query joins pm_trader_events_v2 with pm_market_metadata to get condition_id
  // The join is: trades.token_id IN metadata.token_ids array
  //
  // CRITICAL: pm_trader_events_v2 contains duplicates from historical backfills (2-3x per wallet).
  // We MUST dedupe by event_id at the SQL layer using GROUP BY pattern.
  //
  // NOTE: ClickHouse doesn't allow aggregates in CTEs when WHERE references non-agg columns,
  // so we use a nested subquery pattern instead.
  const query = `
    WITH token_map AS (
      SELECT
        arrayJoin(token_ids) as token_id,
        condition_id,
        indexOf(token_ids, arrayJoin(token_ids)) - 1 as outcome_index
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    -- Dedupe pm_trader_events_v2 by event_id BEFORE joining
    -- Use nested subquery to avoid ClickHouse aggregate-in-CTE-with-WHERE issue
    trades_deduped AS (
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount,
        any(trade_time) as trade_time
      FROM (
        SELECT *
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
      )
      GROUP BY event_id
    )
    SELECT
      'CLOB' as source_type,
      t.trader_wallet as wallet_address,
      lower(tm.condition_id) as condition_id,
      toUInt8(tm.outcome_index) as outcome_index,
      t.trade_time as event_time,
      t.event_id as event_id,
      -- USDC delta: negative for buys (spending), positive for sells (receiving)
      CASE
        WHEN lower(t.side) = 'buy' THEN -toFloat64(t.usdc_amount) / 1e6
        ELSE toFloat64(t.usdc_amount) / 1e6
      END as usdc_delta,
      -- Token delta: positive for buys (receiving tokens), negative for sells
      CASE
        WHEN lower(t.side) = 'buy' THEN toFloat64(t.token_amount) / 1e6
        ELSE -toFloat64(t.token_amount) / 1e6
      END as token_delta,
      0 as payout_norm
    FROM trades_deduped t
    INNER JOIN token_map tm ON t.token_id = tm.token_id
    ORDER BY t.trade_time
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Filter out rows with null/undefined condition_id
  // Map to snake_case to match LedgerEvent interface from shadowLedgerV23.ts
  return rows
    .filter((row) => row.condition_id && typeof row.condition_id === 'string')
    .map((row) => ({
      source_type: row.source_type as 'CLOB' | 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption',
      wallet_address: row.wallet_address,
      condition_id: row.condition_id,
      outcome_index: Number(row.outcome_index),
      event_time: new Date(row.event_time),
      event_id: row.event_id,
      usdc_delta: Number(row.usdc_delta),
      token_delta: Number(row.token_delta),
      payout_norm: Number(row.payout_norm),
    }));
}

/**
 * Load UI prices directly from pm_market_metadata for raw trades.
 * This bypasses the ledger and uses the fresh metadata.
 */
async function loadUIMarketPricesForRawTrades(wallet: string): Promise<Map<string, number>> {
  const query = `
    WITH token_map AS (
      SELECT
        arrayJoin(token_ids) as token_id,
        lower(condition_id) as condition_id,
        indexOf(token_ids, arrayJoin(token_ids)) - 1 as outcome_index,
        outcome_prices
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    traded_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT DISTINCT
      tm.condition_id,
      tm.outcome_index,
      tm.outcome_prices
    FROM token_map tm
    INNER JOIN traded_tokens tt ON tm.token_id = tt.token_id
    WHERE tm.outcome_prices IS NOT NULL
      AND tm.outcome_prices != ''
      AND tm.outcome_prices != '[]'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of rows) {
    // Skip rows with null/undefined condition_id
    if (!r.condition_id) continue;
    const conditionId = r.condition_id.toLowerCase();
    let priceStr = r.outcome_prices;

    try {
      if (priceStr && priceStr.startsWith('"') && priceStr.endsWith('"')) {
        priceStr = priceStr.slice(1, -1);
      }
      if (priceStr) priceStr = priceStr.replace(/\\"/g, '"');
      const priceArray = JSON.parse(priceStr || '[]');

      if (Array.isArray(priceArray)) {
        const outcomeIndex = Number(r.outcome_index);
        if (outcomeIndex >= 0 && outcomeIndex < priceArray.length) {
          const key = `${conditionId}|${outcomeIndex}`;
          const price = Number(priceArray[outcomeIndex]);
          if (!isNaN(price) && isFinite(price) && price >= 0 && price <= 1) {
            prices.set(key, price);
          }
        }
      }
    } catch {
      // Skip malformed price data
    }
  }

  return prices;
}

/**
 * Load resolution prices for conditions traded by raw events.
 */
async function loadResolutionPricesForRawTrades(wallet: string): Promise<Map<string, number>> {
  const query = `
    WITH token_map AS (
      SELECT
        arrayJoin(token_ids) as token_id,
        lower(condition_id) as condition_id
      FROM pm_market_metadata
      WHERE length(token_ids) > 0
        AND condition_id IS NOT NULL
        AND condition_id != ''
    ),
    traded_conditions AS (
      SELECT DISTINCT tm.condition_id
      FROM pm_trader_events_v2 t
      INNER JOIN token_map tm ON t.token_id = tm.token_id
      WHERE lower(t.trader_wallet) = lower('${wallet}')
        AND t.is_deleted = 0
    )
    SELECT DISTINCT
      lower(r.condition_id) as condition_id,
      r.payout_numerators
    FROM pm_condition_resolutions r
    INNER JOIN traded_conditions tc ON lower(r.condition_id) = tc.condition_id
    WHERE r.is_deleted = 0
      AND r.payout_numerators IS NOT NULL
      AND r.payout_numerators != ''
      AND r.payout_numerators != '[]'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const prices = new Map<string, number>();

  for (const r of rows) {
    // Skip rows with null/undefined condition_id
    if (!r.condition_id) continue;
    const conditionId = r.condition_id.toLowerCase();
    try {
      const payouts = JSON.parse(r.payout_numerators || '[]');
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
// V23c Engine
// ============================================================================

/**
 * Calculate PnL using V23c (UI Price Oracle) approach.
 *
 * V23c now includes a "direct bypass" that reads from pm_trader_events_v2
 * and pm_market_metadata when the unified ledger is incomplete.
 *
 * @param wallet - Wallet address
 * @param options - { useUIOracle: true } uses pm_market_metadata.outcome_prices
 * @returns V23cResult with PnL and diagnostic info
 */
export async function calculateV23cPnL(
  wallet: string,
  options: V23cOptions = { useUIOracle: true }
): Promise<V23cResult> {
  const engine = new ShadowLedgerEngine();

  // ============================================================================
  // FAST PATH: Use preloaded data if available
  // ============================================================================
  if (options?.preload) {
    engine.processEvents(options.preload.events);

    const resolutionPrices = options.preload.resolutionPrices;
    const uiPrices = options.preload.uiPrices;

    // Create price oracle with priority:
    // 1. Resolution price (if resolved)
    // 2. UI price (pm_market_metadata.outcome_prices)
    // 3. $0.50 default
    const priceOracle = (conditionId: string, outcomeIndex: number): number => {
      if (!conditionId) return 0.5;
      const key = `${conditionId.toLowerCase()}|${outcomeIndex}`;

      // 1. Resolution price (highest priority)
      const resPrice = resolutionPrices.get(key);
      if (resPrice !== undefined) {
        return resPrice;
      }

      // 2. UI price (pm_market_metadata.outcome_prices)
      if (options.useUIOracle) {
        const uiPrice = uiPrices.get(key);
        if (uiPrice !== undefined) {
          return uiPrice;
        }
      }

      // 3. Default to $0.50
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
      if (!pos.conditionId) continue;
      const key = `${pos.conditionId.toLowerCase()}|${pos.outcomeIndex}`;
      if (!resolutionPrices.has(key) && Math.abs(pos.quantity) > 0.01) {
        unresolvedConditions++;
      }
    }

    return {
      ...baseResult,
      uiOracleUsed: options.useUIOracle ?? true,
      unresolvedConditions,
      uiPricesLoaded: uiPrices.size,
      lastPricesLoaded: 0, // Not loaded in preload mode
    };
  }

  // ============================================================================
  // SLOW PATH: Per-wallet ClickHouse queries (legacy)
  // ============================================================================

  // Load events from unified ledger (may be incomplete)
  const ledgerEvents = await loadLedgerEventsForWallet(wallet);

  // Load raw trades fallback (direct from pm_trader_events_v2)
  const rawEvents = await loadRawTradesFallback(wallet);

  // Merge: Use raw events if ledger is empty or incomplete
  // Create a set of event IDs from ledger to dedupe
  const ledgerEventIds = new Set(ledgerEvents.map((e) => e.event_id));

  // Add raw events that aren't already in the ledger
  const fallbackEvents = rawEvents.filter((e) => !ledgerEventIds.has(e.event_id));

  // Combine all events
  const allEvents = [...ledgerEvents, ...fallbackEvents];

  engine.processEvents(allEvents);

  // Load resolution prices (highest priority) - from both ledger and raw trades
  const resolutionPricesLedger = await loadResolutionPrices(wallet);
  const resolutionPricesRaw = await loadResolutionPricesForRawTrades(wallet);
  const resolutionPrices = new Map([...resolutionPricesLedger, ...resolutionPricesRaw]);

  // Load UI prices (if enabled) - from both ledger and raw trades
  let uiPrices = new Map<string, number>();
  if (options.useUIOracle) {
    const uiPricesLedger = await loadUIMarketPrices(wallet);
    const uiPricesRaw = await loadUIMarketPricesForRawTrades(wallet);
    uiPrices = new Map([...uiPricesLedger, ...uiPricesRaw]);
  }

  // Load last trade prices (fallback)
  const lastPrices = await loadLastTradePrices(wallet);

  // Create a combined price oracle with priority:
  // 1. Resolution price (if resolved)
  // 2. UI price (pm_market_metadata.outcome_prices)
  // 3. Last trade price
  // 4. $0.50 default
  const priceOracle = (conditionId: string, outcomeIndex: number): number => {
    // Handle null/undefined conditionId
    if (!conditionId) return 0.5;
    const key = `${conditionId.toLowerCase()}|${outcomeIndex}`;

    // 1. Resolution price (highest priority)
    const resPrice = resolutionPrices.get(key);
    if (resPrice !== undefined) {
      return resPrice;
    }

    // 2. UI price (pm_market_metadata.outcome_prices)
    if (options.useUIOracle) {
      const uiPrice = uiPrices.get(key);
      if (uiPrice !== undefined) {
        return uiPrice;
      }
    }

    // 3. Last trade price (fallback)
    const lastPrice = lastPrices.get(key);
    if (lastPrice !== undefined) {
      return lastPrice;
    }

    // 4. Default to $0.50
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
    // Skip positions with null/undefined conditionId
    if (!pos.conditionId) continue;
    const key = `${pos.conditionId.toLowerCase()}|${pos.outcomeIndex}`;
    if (!resolutionPrices.has(key) && Math.abs(pos.quantity) > 0.01) {
      unresolvedConditions++;
    }
  }

  return {
    ...baseResult,
    uiOracleUsed: options.useUIOracle ?? true,
    unresolvedConditions,
    uiPricesLoaded: uiPrices.size,
    lastPricesLoaded: lastPrices.size,
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Calculate V23c PnL with UI Oracle (default behavior)
 */
export async function calculateV23cUIOracle(wallet: string): Promise<V23cResult> {
  return calculateV23cPnL(wallet, { useUIOracle: true });
}

/**
 * Calculate V23c PnL with last trade price fallback (V23b behavior)
 */
export async function calculateV23cLastTrade(wallet: string): Promise<V23cResult> {
  return calculateV23cPnL(wallet, { useUIOracle: false });
}
