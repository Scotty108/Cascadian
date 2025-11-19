/**
 * Ingestion Guardrail - Simple validation for pm_trades ingestion layer
 *
 * Lighter version of ETL guardrail adapted for CLOB/Goldsky ingestion scripts
 * Focuses on preventing duplicate trade_ids at ingestion time
 *
 * Usage in ingestion scripts:
 *   import { shouldIngestTrade } from '@/lib/ingestion-guardrail';
 *
 *   const allowed = await shouldIngestTrade(trade, clickhouse);
 *   if (!allowed) continue; // Skip duplicate
 */

import { ClickHouseClient } from '@clickhouse/client';

/**
 * Simple duplicate check - returns true if trade should be ingested
 * Returns false if trade_id already exists (duplicate)
 */
export async function shouldIngestTrade(
  trade: { id?: string; transaction_hash?: string; [key: string]: any },
  clickhouse: ClickHouseClient,
  table: string = 'pm_trades_canonical_v3'
): Promise<boolean> {
  // Get trade_id (different field names in different sources)
  const tradeId = trade.id || trade.trade_id || `${trade.transaction_hash}-${trade.timestamp || Date.now()}`;

  if (!tradeId) {
    // If no trade_id, allow (will be caught by downstream validation)
    return true;
  }

  try {
    // Check if trade_id already exists
    const result = await clickhouse.query({
      query: `SELECT count() AS exists FROM ${table} WHERE trade_id = {trade_id:String} LIMIT 1`,
      query_params: { trade_id: tradeId },
      format: 'JSONEachRow'
    });

    const data = await result.json<any>();
    const exists = data[0]?.exists > 0;

    // Return false if exists (duplicate), true if new
    return !exists;
  } catch (e) {
    // On error, allow trade (fail open to not block ingestion)
    console.error(`Guardrail check error for ${tradeId}:`, e);
    return true;
  }
}

/**
 * Batch duplicate check - more efficient for bulk ingestion
 * Returns array of trades that should be ingested (non-duplicates)
 */
export async function filterDuplicateTrades<T extends { id?: string; trade_id?: string; transaction_hash?: string; [key: string]: any }>(
  trades: T[],
  clickhouse: ClickHouseClient,
  table: string = 'pm_trades_canonical_v3'
): Promise<T[]> {
  if (trades.length === 0) return [];

  // Extract trade_ids
  const tradeIds = trades.map(t =>
    t.id || t.trade_id || `${t.transaction_hash}-${t.timestamp || Date.now()}`
  ).filter(Boolean);

  if (tradeIds.length === 0) return trades;

  try {
    // Batch check for existing trade_ids
    const placeholders = tradeIds.map((_, i) => `{id${i}:String}`).join(',');
    const params: Record<string, string> = {};
    tradeIds.forEach((id, i) => {
      params[`id${i}`] = id;
    });

    const result = await clickhouse.query({
      query: `SELECT trade_id FROM ${table} WHERE trade_id IN (${placeholders})`,
      query_params: params,
      format: 'JSONEachRow'
    });

    const existingIds = new Set((await result.json<any>()).map((row: any) => row.trade_id));

    // Filter out trades with existing IDs
    return trades.filter(t => {
      const tradeId = t.id || t.trade_id || `${t.transaction_hash}-${t.timestamp || Date.now()}`;
      return !existingIds.has(tradeId);
    });
  } catch (e) {
    // On error, return all trades (fail open)
    console.error('Batch guardrail check error:', e);
    return trades;
  }
}

/**
 * Normalize wallet address to lowercase
 */
export function normalizeWalletAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  return address.toLowerCase();
}

/**
 * Normalize condition_id to 64-char lowercase hex (no 0x prefix)
 */
export function normalizeConditionId(cid: string | undefined | null): string | undefined {
  if (!cid) return undefined;

  // Strip 0x prefix if present
  let normalized = cid.toLowerCase().replace(/^0x/, '');

  // Validate it's 64-char hex
  if (normalized.length === 64 && /^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }

  // If not valid, return undefined
  return undefined;
}
