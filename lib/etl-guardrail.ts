/**
 * ETL Guardrail - Prevent Data Quality Issues at Ingestion
 *
 * Features:
 * 1. Normalize wallet_address (lowercase)
 * 2. Normalize condition_id (strip 0x, lowercase, 64-char)
 * 3. Detect attribution conflicts (tx_hash with different wallets)
 * 4. Block duplicate trade_ids
 * 5. Quarantine problematic trades
 *
 * Usage:
 *   import { validateAndNormalizeTrade } from '../lib/etl-guardrail';
 *
 *   const result = await validateAndNormalizeTrade(trade, clickhouse);
 *   if (!result.allowed) {
 *     console.log(`Quarantined: ${result.reason}`);
 *     continue; // Skip this trade
 *   }
 *   // Proceed with result.normalized trade
 */

import { ClickHouseClient } from '@clickhouse/client';

export interface IncomingTrade {
  trade_id: string;
  transaction_hash: string;
  wallet_address: string;
  condition_id?: string;
  outcome_index?: number;
  trade_direction?: string;
  shares?: number;
  price?: number;
  usd_value?: number;
  fee?: number;
  timestamp?: Date | string;
  source?: string;
  [key: string]: any;
}

export interface NormalizedTrade extends IncomingTrade {
  wallet_address: string; // Normalized (lowercase)
  condition_id_norm_v3?: string; // Normalized (64-char lowercase hex)
  wallet_canonical?: string; // Resolved canonical wallet
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  normalized?: NormalizedTrade;
}

interface ConflictCheck {
  transaction_hash: string;
  existing_wallet: string;
  incoming_wallet: string;
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

  // If not valid, return undefined (will be orphan)
  return undefined;
}

/**
 * Normalize wallet address to lowercase
 */
export function normalizeWalletAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Main validation and normalization function
 *
 * Returns:
 *   { allowed: true, normalized: NormalizedTrade } - Trade can be inserted
 *   { allowed: false, reason: string } - Trade should be quarantined
 */
export async function validateAndNormalizeTrade(
  trade: IncomingTrade,
  clickhouse: ClickHouseClient
): Promise<ValidationResult> {
  // Step 1: Normalize inputs
  const normalized: NormalizedTrade = {
    ...trade,
    wallet_address: normalizeWalletAddress(trade.wallet_address),
    condition_id_norm_v3: normalizeConditionId(trade.condition_id),
  };

  // Step 2: Check for duplicate trade_id (prevent re-ingestion)
  try {
    const dupCheckResult = await clickhouse.query({
      query: `
        SELECT count() AS dup_count
        FROM pm_trades_canonical_v3
        WHERE trade_id = {trade_id:String}
      `,
      query_params: { trade_id: normalized.trade_id },
      format: 'JSONEachRow'
    });

    const dupData = await dupCheckResult.json<{ dup_count: number }>();
    if (dupData[0]?.dup_count > 0) {
      // Quarantine: duplicate trade_id
      await quarantineTrade(normalized, 'duplicate_trade_id', clickhouse);
      return {
        allowed: false,
        reason: 'duplicate_trade_id'
      };
    }
  } catch (error) {
    console.error('Duplicate check failed:', error);
    // Allow on error (don't block pipeline)
  }

  // Step 3: Resolve canonical wallet
  try {
    const walletResult = await clickhouse.query({
      query: `
        SELECT canonical_wallet
        FROM wallet_identity_map
        WHERE lower(user_eoa) = {wallet:String}
           OR lower(proxy_wallet) = {wallet:String}
        LIMIT 1
      `,
      query_params: { wallet: normalized.wallet_address },
      format: 'JSONEachRow'
    });

    const walletData = await walletResult.json<{ canonical_wallet: string }>();
    normalized.wallet_canonical = walletData[0]?.canonical_wallet || normalized.wallet_address;
  } catch (error) {
    console.error('Wallet resolution failed:', error);
    // Use normalized wallet as canonical on error
    normalized.wallet_canonical = normalized.wallet_address;
  }

  // Step 4: Check for attribution conflicts (tx_hash with different wallet)
  try {
    const conflictResult = await clickhouse.query({
      query: `
        SELECT
          transaction_hash,
          any(wallet_canonical) AS existing_wallet,
          {incoming_wallet:String} AS incoming_wallet
        FROM pm_trades_canonical_v3
        WHERE transaction_hash = {tx_hash:String}
          AND wallet_canonical != {incoming_wallet:String}
        GROUP BY transaction_hash
        LIMIT 1
      `,
      query_params: {
        tx_hash: normalized.transaction_hash,
        incoming_wallet: normalized.wallet_canonical!
      },
      format: 'JSONEachRow'
    });

    const conflictData = await conflictResult.json<ConflictCheck>();
    if (conflictData.length > 0) {
      // Quarantine: attribution conflict
      await quarantineTrade(normalized, 'attribution_conflict', clickhouse);
      return {
        allowed: false,
        reason: 'attribution_conflict'
      };
    }
  } catch (error) {
    console.error('Attribution conflict check failed:', error);
    // Allow on error (don't block pipeline)
  }

  // Step 5: Warn on empty condition_id (orphan)
  if (!normalized.condition_id_norm_v3 || normalized.condition_id_norm_v3.length !== 64) {
    // Don't block, but mark as orphan
    // (orphans are allowed but tracked)
  }

  // All checks passed
  return {
    allowed: true,
    normalized
  };
}

/**
 * Quarantine a problematic trade to pm_trades_attribution_conflicts
 */
async function quarantineTrade(
  trade: NormalizedTrade,
  reason: string,
  clickhouse: ClickHouseClient
): Promise<void> {
  try {
    await clickhouse.insert({
      table: 'pm_trades_attribution_conflicts',
      values: [{
        transaction_hash: trade.transaction_hash,
        wallet_address: trade.wallet_address,
        wallet_canonical: trade.wallet_canonical || trade.wallet_address,
        condition_id_norm_v3: trade.condition_id_norm_v3 || '',
        trade_direction: trade.trade_direction || 'UNKNOWN',
        shares: trade.shares || 0,
        usd_value: trade.usd_value || 0,
        timestamp: trade.timestamp || new Date(),
        detected_at: new Date(),
        resolution_status: 'unresolved',
        resolution_notes: `Quarantined: ${reason}`,
        source_system: 'etl_guardrail'
      }],
      format: 'JSONEachRow'
    });
  } catch (error) {
    console.error('Failed to quarantine trade:', error);
    // Don't throw - just log error
  }
}

/**
 * Batch validation (for high-throughput ingestion)
 *
 * Validates multiple trades in parallel for better performance.
 * Returns array of ValidationResult in same order as input.
 */
export async function validateAndNormalizeBatch(
  trades: IncomingTrade[],
  clickhouse: ClickHouseClient
): Promise<ValidationResult[]> {
  // Process in parallel batches of 100
  const batchSize = 100;
  const results: ValidationResult[] = [];

  for (let i = 0; i < trades.length; i += batchSize) {
    const batch = trades.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(trade => validateAndNormalizeTrade(trade, clickhouse))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Get guardrail statistics (for monitoring)
 */
export async function getGuardrailStats(
  clickhouse: ClickHouseClient,
  since: Date = new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
): Promise<{
  total_quarantined: number;
  duplicate_trade_ids: number;
  attribution_conflicts: number;
  by_source: Record<string, number>;
}> {
  const result = await clickhouse.query({
    query: `
      SELECT
        count() AS total_quarantined,
        countIf(resolution_notes LIKE '%duplicate_trade_id%') AS duplicate_trade_ids,
        countIf(resolution_notes LIKE '%attribution_conflict%') AS attribution_conflicts,
        groupArray((source_system, count)) AS sources
      FROM pm_trades_attribution_conflicts
      WHERE detected_at >= {since:DateTime}
    `,
    query_params: { since: since.toISOString().replace('T', ' ').substring(0, 19) },
    format: 'JSONEachRow'
  });

  const data = await result.json<any>();
  return {
    total_quarantined: data[0]?.total_quarantined || 0,
    duplicate_trade_ids: data[0]?.duplicate_trade_ids || 0,
    attribution_conflicts: data[0]?.attribution_conflicts || 0,
    by_source: {}
  };
}
