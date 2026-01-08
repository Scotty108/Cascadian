/**
 * ============================================================================
 * REALIZED PNL ENGINE V12 - PRODUCTION GRADE (CLOB-ONLY)
 * ============================================================================
 *
 * V12 incorporates all learnings from V8 → V11:
 * 1. Sources from pm_trader_events_v3 (complete) NOT pm_trader_events_dedup_v2_tbl
 * 2. Query-time dedup with GROUP BY event_id using argMax pattern
 * 3. Joins pm_token_to_condition_map_v5 for condition/outcome mapping
 * 4. Joins pm_condition_resolutions for payout info
 * 5. CRITICAL FIX: payout_numerators = '' treated as unresolved (not resolved with 0)
 *
 * FORMULA (resolved markets only, no synthetic resolutions):
 *   realized_pnl = usdc_delta + (token_delta * payout_norm)
 *
 * WHERE:
 *   - payout_numerators IS NOT NULL AND payout_numerators != ''
 *   - outcome_index IS NOT NULL
 *
 * This module provides:
 *   - calculateRealizedPnlV12(wallet) → single wallet realized PnL
 *   - batchCalculateRealizedPnlV12(wallets) → batch calculation
 *   - getRealizedStats(wallet) → detailed breakdown for diagnostics
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { CANONICAL_TABLES } from './canonicalTables';

// ============================================================================
// Types
// ============================================================================

export interface RealizedPnlResult {
  wallet: string;
  realizedPnl: number;
  eventCount: number;
  resolvedEvents: number;
  unresolvedEvents: number;
  unresolvedPct: number;
  unresolvedUsdcSpent: number;
  makerEvents: number;
  takerEvents: number;
  isComparable: boolean; // true if unresolved < 50%
  errors: string[];
}

export interface RealizedStats extends RealizedPnlResult {
  uniqueConditions: number;
  resolvedConditions: number;
  unresolvedConditions: number;
  unmappedTokens: number;
}

interface CalcOptions {
  makerOnly?: boolean; // default true
  // Note: sourceTable option is unused - V12 always uses CANONICAL_TABLES.TRADER_EVENTS
}

// ============================================================================
// ClickHouse Client
// ============================================================================

let chClient: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!chClient) {
    chClient = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
      request_timeout: 300000,
    });
  }
  return chClient;
}

export function closeClient(): Promise<void> {
  if (chClient) {
    const client = chClient;
    chClient = null;
    return client.close();
  }
  return Promise.resolve();
}

// ============================================================================
// Core Calculation - V12 Formula
// ============================================================================

/**
 * Calculate realized PnL for a single wallet using V12 formula.
 *
 * Key features:
 * - Sources from pm_trader_events_v3 (complete source)
 * - Query-time dedup via GROUP BY event_id
 * - Handles empty string payout_numerators as unresolved
 * - No synthetic resolutions - only actual resolved markets count
 */
export async function calculateRealizedPnlV12(
  wallet: string,
  options: CalcOptions = {}
): Promise<RealizedPnlResult> {
  const { makerOnly = true } = options;
  const ch = getClient();

  const roleFilter = makerOnly ? "AND te.role = 'maker'" : '';

  const query = `
    SELECT
      -- Realized PnL (resolved markets only)
      sum(
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            usdc_delta + (token_delta *
              if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
                 toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
            )
          ELSE 0
        END
      ) as realized_pnl,

      -- Event counts
      count() as event_count,
      countIf(res.payout_numerators IS NOT NULL AND res.payout_numerators != '' AND map.outcome_index IS NOT NULL) as resolved_events,
      countIf(res.payout_numerators IS NULL OR res.payout_numerators = '' OR map.outcome_index IS NULL) as unresolved_events,

      -- Role breakdown
      countIf(role = 'maker') as maker_events,
      countIf(role = 'taker') as taker_events,

      -- Unresolved USDC exposure (how much spent on unresolved markets)
      sum(
        CASE
          WHEN (res.payout_numerators IS NULL OR res.payout_numerators = '') AND usdc_delta < 0
          THEN abs(usdc_delta)
          ELSE 0
        END
      ) as unresolved_usdc_spent

    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM ${CANONICAL_TABLES.TRADER_EVENTS}
      WHERE trader_wallet = {wallet:String}
      GROUP BY event_id
    ) AS te
    LEFT JOIN ${CANONICAL_TABLES.TOKEN_MAP} AS map ON te.token_id = map.token_id_dec
    LEFT JOIN ${CANONICAL_TABLES.RESOLUTIONS} AS res ON map.condition_id = res.condition_id
    WHERE 1=1 ${roleFilter}
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const eventCount = Number(row.event_count || 0);
    const resolvedEvents = Number(row.resolved_events || 0);
    const unresolvedEvents = Number(row.unresolved_events || 0);
    const unresolvedPct = eventCount > 0 ? (unresolvedEvents / eventCount) * 100 : 0;

    return {
      wallet,
      realizedPnl: Number(row.realized_pnl || 0),
      eventCount,
      resolvedEvents,
      unresolvedEvents,
      unresolvedPct,
      unresolvedUsdcSpent: Number(row.unresolved_usdc_spent || 0),
      makerEvents: Number(row.maker_events || 0),
      takerEvents: Number(row.taker_events || 0),
      isComparable: unresolvedPct < 50,
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      realizedPnl: 0,
      eventCount: 0,
      resolvedEvents: 0,
      unresolvedEvents: 0,
      unresolvedPct: 0,
      unresolvedUsdcSpent: 0,
      makerEvents: 0,
      takerEvents: 0,
      isComparable: false,
      errors: [error.message],
    };
  }
}

// ============================================================================
// Batch Calculation
// ============================================================================

/**
 * Calculate realized PnL for multiple wallets.
 * Runs sequentially to avoid overwhelming the database.
 */
export async function batchCalculateRealizedPnlV12(
  wallets: string[],
  options: CalcOptions = {},
  onProgress?: (completed: number, total: number) => void
): Promise<RealizedPnlResult[]> {
  const results: RealizedPnlResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const result = await calculateRealizedPnlV12(wallets[i], options);
    results.push(result);
    if (onProgress) {
      onProgress(i + 1, wallets.length);
    }
  }

  return results;
}

// ============================================================================
// Detailed Stats (for diagnostics)
// ============================================================================

/**
 * Get detailed realized PnL stats for a wallet.
 * Includes condition-level breakdown for debugging.
 */
export async function getRealizedStats(
  wallet: string,
  options: CalcOptions = {}
): Promise<RealizedStats> {
  const { makerOnly = true } = options;
  const ch = getClient();

  const roleFilter = makerOnly ? "AND te.role = 'maker'" : '';

  const query = `
    SELECT
      -- Same as V12 base
      sum(
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            usdc_delta + (token_delta *
              if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
                 toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
            )
          ELSE 0
        END
      ) as realized_pnl,

      count() as event_count,
      countIf(res.payout_numerators IS NOT NULL AND res.payout_numerators != '' AND map.outcome_index IS NOT NULL) as resolved_events,
      countIf(res.payout_numerators IS NULL OR res.payout_numerators = '' OR map.outcome_index IS NULL) as unresolved_events,
      countIf(role = 'maker') as maker_events,
      countIf(role = 'taker') as taker_events,

      sum(
        CASE
          WHEN (res.payout_numerators IS NULL OR res.payout_numerators = '') AND usdc_delta < 0
          THEN abs(usdc_delta)
          ELSE 0
        END
      ) as unresolved_usdc_spent,

      -- Condition-level stats
      countDistinct(map.condition_id) as unique_conditions,
      countDistinct(if(res.payout_numerators IS NOT NULL AND res.payout_numerators != '', map.condition_id, NULL)) as resolved_conditions,
      countDistinct(if(res.payout_numerators IS NULL OR res.payout_numerators = '', map.condition_id, NULL)) as unresolved_conditions,
      countIf(map.condition_id IS NULL) as unmapped_tokens

    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM ${CANONICAL_TABLES.TRADER_EVENTS}
      WHERE trader_wallet = {wallet:String}
      GROUP BY event_id
    ) AS te
    LEFT JOIN ${CANONICAL_TABLES.TOKEN_MAP} AS map ON te.token_id = map.token_id_dec
    LEFT JOIN ${CANONICAL_TABLES.RESOLUTIONS} AS res ON map.condition_id = res.condition_id
    WHERE 1=1 ${roleFilter}
  `;

  try {
    const result = await ch.query({
      query,
      query_params: { wallet },
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const eventCount = Number(row.event_count || 0);
    const resolvedEvents = Number(row.resolved_events || 0);
    const unresolvedEvents = Number(row.unresolved_events || 0);
    const unresolvedPct = eventCount > 0 ? (unresolvedEvents / eventCount) * 100 : 0;

    return {
      wallet,
      realizedPnl: Number(row.realized_pnl || 0),
      eventCount,
      resolvedEvents,
      unresolvedEvents,
      unresolvedPct,
      unresolvedUsdcSpent: Number(row.unresolved_usdc_spent || 0),
      makerEvents: Number(row.maker_events || 0),
      takerEvents: Number(row.taker_events || 0),
      isComparable: unresolvedPct < 50,
      uniqueConditions: Number(row.unique_conditions || 0),
      resolvedConditions: Number(row.resolved_conditions || 0),
      unresolvedConditions: Number(row.unresolved_conditions || 0),
      unmappedTokens: Number(row.unmapped_tokens || 0),
      errors: [],
    };
  } catch (error: any) {
    return {
      wallet,
      realizedPnl: 0,
      eventCount: 0,
      resolvedEvents: 0,
      unresolvedEvents: 0,
      unresolvedPct: 0,
      unresolvedUsdcSpent: 0,
      makerEvents: 0,
      takerEvents: 0,
      isComparable: false,
      uniqueConditions: 0,
      resolvedConditions: 0,
      unresolvedConditions: 0,
      unmappedTokens: 0,
      errors: [error.message],
    };
  }
}
