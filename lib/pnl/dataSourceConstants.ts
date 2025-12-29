/**
 * Data Source Constants for PnL Engines
 *
 * ============================================================================
 * SINGLE SOURCE OF TRUTH FOR TABLE VERSIONS
 * ============================================================================
 *
 * All PnL engines should import these constants rather than hardcoding
 * table names. This prevents version drift and ensures consistent data.
 *
 * Version History:
 * - 2025-12-07: Created with V5 token map, V8 unified ledger
 */

/**
 * Token-to-condition mapping table
 *
 * V5 has 400K+ tokens vs V3's 358K - use V5 to avoid unmapped trades
 */
export const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';

/**
 * Unified ledger table (CLOB + CTF events)
 *
 * V8 has 347M rows with proper deduplication
 */
export const UNIFIED_LEDGER_TABLE = 'pm_unified_ledger_v8_tbl';

/**
 * CLOB-only ledger table (V9)
 *
 * V9 has ~100M rows - CLOB trades only (no CTF split/merge/redemption events)
 * Built from deduplicated staging table (pm_trader_events_dedup_v2_tbl FINAL)
 * Use this for CLOB-only validation and fast PnL calculations on pure traders
 */
export const CLOB_ONLY_LEDGER_TABLE = 'pm_unified_ledger_v9_clob_tbl';

/**
 * Ledger source options for PnL engines
 */
export type LedgerSource = 'v8_unified' | 'v9_clob_only';

/**
 * Get the actual table name for a ledger source
 */
export function getLedgerTable(source: LedgerSource = 'v8_unified'): string {
  switch (source) {
    case 'v9_clob_only':
      return CLOB_ONLY_LEDGER_TABLE;
    case 'v8_unified':
    default:
      return UNIFIED_LEDGER_TABLE;
  }
}

/**
 * Condition resolutions table
 */
export const RESOLUTIONS_TABLE = 'pm_condition_resolutions';

/**
 * CLOB trader events table
 *
 * Note: This table has duplicates from historical backfills.
 * ALWAYS use GROUP BY event_id pattern when querying.
 */
export const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';

/**
 * Dome realized benchmarks table
 */
export const DOME_BENCHMARKS_TABLE = 'pm_dome_realized_benchmarks_v1';

/**
 * Helper to build the standard CLOB deduplication subquery
 *
 * Usage:
 *   const subquery = buildClobDedupeSubquery(wallet);
 *   const query = `SELECT ... FROM (${subquery}) fills ...`;
 */
export function buildClobDedupeSubquery(wallet: string): string {
  return `
    SELECT
      any(token_id) as token_id,
      any(trade_time) as trade_time,
      any(side) as side,
      any(token_amount) / 1000000.0 as qty_tokens,
      any(usdc_amount) / 1000000.0 as usdc_notional,
      any(transaction_hash) as tx_hash,
      CASE WHEN any(token_amount) > 0
        THEN any(usdc_amount) / any(token_amount)
        ELSE 0
      END as price
    FROM ${TRADER_EVENTS_TABLE}
    WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
    GROUP BY event_id
  `;
}

/**
 * Helper to build the standard token mapping join
 */
export function buildTokenMapJoin(tokenIdColumn: string = 'token_id'): string {
  return `INNER JOIN ${TOKEN_MAP_TABLE} m ON ${tokenIdColumn} = m.token_id_dec`;
}
