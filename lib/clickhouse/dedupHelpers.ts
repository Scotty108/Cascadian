/**
 * Deduplication Helper Functions
 *
 * Systematic approach to querying deduplicated data.
 * After materialized views are deployed, these helpers ensure
 * consistent, fast, safe queries across all code.
 */

import { ClickHouseClient } from '@clickhouse/client';

/**
 * Query canonical fills with automatic deduplication
 *
 * Use this for wallet-specific queries to avoid GROUP BY overhead.
 * After materialized view deployment, this queries the _deduped view.
 */
export async function getCanonicalFillsForWallet(
  client: ClickHouseClient,
  wallet: string,
  options?: {
    conditionId?: string;
    outcomeIndex?: number;
    startTime?: Date;
    endTime?: Date;
    source?: 'clob' | 'ctf' | 'negrisk';
  }
): Promise<any[]> {
  let whereConditions = [`wallet = {wallet:String}`];

  const params: Record<string, any> = {
    wallet: wallet.toLowerCase(),
  };

  if (options?.conditionId) {
    whereConditions.push('condition_id = {conditionId:String}');
    params.conditionId = options.conditionId.toLowerCase();
  }

  if (options?.outcomeIndex !== undefined) {
    whereConditions.push('outcome_index = {outcomeIndex:UInt8}');
    params.outcomeIndex = options.outcomeIndex;
  }

  if (options?.startTime) {
    whereConditions.push('event_time >= {startTime:DateTime}');
    params.startTime = options.startTime;
  }

  if (options?.endTime) {
    whereConditions.push('event_time <= {endTime:DateTime}');
    params.endTime = options.endTime;
  }

  if (options?.source) {
    whereConditions.push('source = {source:String}');
    params.source = options.source;
  }

  const query = `
    SELECT *
    FROM pm_canonical_fills_v4_deduped FINAL
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY event_time ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  return (await result.json()) as any[];
}

/**
 * Query FIFO positions with automatic deduplication
 *
 * Returns deduplicated positions for a wallet.
 */
export async function getFifoPositionsForWallet(
  client: ClickHouseClient,
  wallet: string,
  options?: {
    conditionId?: string;
    resolved?: boolean;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<any[]> {
  let whereConditions = [`wallet = {wallet:String}`];

  const params: Record<string, any> = {
    wallet: wallet.toLowerCase(),
  };

  if (options?.conditionId) {
    whereConditions.push('condition_id = {conditionId:String}');
    params.conditionId = options.conditionId.toLowerCase();
  }

  if (options?.resolved !== undefined) {
    if (options.resolved) {
      whereConditions.push(`resolved_at > '1970-01-02'`);
    } else {
      whereConditions.push(`resolved_at <= '1970-01-02'`);
    }
  }

  if (options?.startDate) {
    whereConditions.push('resolved_at >= {startDate:DateTime}');
    params.startDate = options.startDate;
  }

  if (options?.endDate) {
    whereConditions.push('resolved_at <= {endDate:DateTime}');
    params.endDate = options.endDate;
  }

  const query = `
    SELECT *
    FROM pm_trade_fifo_roi_v3_deduped FINAL
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY entry_time ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  return (await result.json()) as any[];
}

/**
 * Get aggregated PnL for a wallet from FIFO table
 *
 * Returns total realized PnL with proper deduplication.
 */
export async function getWalletRealizedPnL(
  client: ClickHouseClient,
  wallet: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<number> {
  let whereConditions = [`wallet = {wallet:String}`];

  const params: Record<string, any> = {
    wallet: wallet.toLowerCase(),
  };

  if (options?.startDate) {
    whereConditions.push('resolved_at >= {startDate:DateTime}');
    params.startDate = options.startDate;
  }

  if (options?.endDate) {
    whereConditions.push('resolved_at <= {endDate:DateTime}');
    params.endDate = options.endDate;
  }

  const query = `
    SELECT round(sum(pnl_usd), 2) as realized_pnl
    FROM pm_trade_fifo_roi_v3_deduped FINAL
    WHERE ${whereConditions.join(' AND ')}
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  return rows[0]?.realized_pnl || 0;
}

/**
 * Query trader events with automatic deduplication
 *
 * For legacy queries that need pm_trader_events_v2 data.
 */
export async function getTraderEventsForWallet(
  client: ClickHouseClient,
  wallet: string,
  options?: {
    startTime?: Date;
    endTime?: Date;
    side?: 'buy' | 'sell';
  }
): Promise<any[]> {
  let whereConditions = [`trader_wallet = {wallet:String}`, `is_deleted = 0`];

  const params: Record<string, any> = {
    wallet: wallet.toLowerCase(),
  };

  if (options?.startTime) {
    whereConditions.push('trade_time >= {startTime:DateTime}');
    params.startTime = options.startTime;
  }

  if (options?.endTime) {
    whereConditions.push('trade_time <= {endTime:DateTime}');
    params.endTime = options.endTime;
  }

  if (options?.side) {
    whereConditions.push('side = {side:String}');
    params.side = options.side;
  }

  const query = `
    SELECT *
    FROM pm_trader_events_v2_deduped FINAL
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY trade_time ASC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  });

  return (await result.json()) as any[];
}

/**
 * Fallback: Legacy GROUP BY deduplication (use only during migration)
 *
 * @deprecated Use materialized views instead
 */
export function wrapWithDeduplication(
  baseQuery: string,
  table: 'pm_canonical_fills_v4' | 'pm_trade_fifo_roi_v3' | 'pm_trader_events_v2'
): string {
  console.warn(`[DEPRECATED] Using legacy GROUP BY deduplication for ${table}. Migrate to _deduped views.`);

  if (table === 'pm_canonical_fills_v4') {
    return `
      WITH deduped_fills AS (
        SELECT
          fill_id,
          any(event_time) as event_time,
          any(block_number) as block_number,
          any(tx_hash) as tx_hash,
          any(wallet) as wallet,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index,
          any(tokens_delta) as tokens_delta,
          any(usdc_delta) as usdc_delta,
          any(source) as source,
          any(is_self_fill) as is_self_fill,
          any(is_maker) as is_maker
        FROM ${table}
        GROUP BY fill_id
      )
      ${baseQuery}
    `.replace(new RegExp(table, 'g'), 'deduped_fills');
  }

  if (table === 'pm_trade_fifo_roi_v3') {
    return `
      WITH deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(tx_hash) as tx_hash,
          any(entry_time) as entry_time,
          any(tokens) as tokens,
          any(cost_usd) as cost_usd,
          any(tokens_sold_early) as tokens_sold_early,
          any(tokens_held) as tokens_held,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(pct_sold_early) as pct_sold_early,
          any(is_maker) as is_maker,
          any(resolved_at) as resolved_at,
          any(is_short) as is_short
        FROM ${table}
        GROUP BY wallet, condition_id, outcome_index
      )
      ${baseQuery}
    `.replace(new RegExp(table, 'g'), 'deduped_fifo');
  }

  if (table === 'pm_trader_events_v2') {
    return `
      WITH deduped_events AS (
        SELECT
          event_id,
          any(trader_wallet) as trader_wallet,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount,
          any(trade_time) as trade_time,
          any(is_deleted) as is_deleted
        FROM ${table}
        WHERE is_deleted = 0
        GROUP BY event_id
      )
      ${baseQuery}
    `.replace(new RegExp(table, 'g'), 'deduped_events');
  }

  return baseQuery;
}
