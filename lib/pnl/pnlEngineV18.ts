/**
 * PnL Engine V18 - Phantom Split Filter (Two-Query)
 *
 * Simpler approach: 
 * 1. Query to find phantom sells
 * 2. Main query excludes them using NOT IN
 *
 * @author Claude Code
 * @version 18.2.0
 * @created 2026-01-08
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV18 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  phantomTradesExcluded: number;
  confidence: 'high' | 'medium' | 'low';
}

export async function getWalletPnLV18(wallet: string): Promise<PnLResultV18> {
  const w = wallet.toLowerCase();

  // Step 1: Find all phantom sell (tx, condition, outcome) tuples
  const phantomQuery = `
    SELECT 
      s.tx_hash as tx_hash,
      s.condition_id as condition_id,
      s.outcome_index as outcome_index
    FROM (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id as condition_id,
        m.outcome_index as outcome_index,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL
        AND t.side = 'sell'
      GROUP BY tx_hash, m.condition_id, m.outcome_index
    ) s
    INNER JOIN (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id as condition_id,
        m.outcome_index as outcome_index,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL
        AND t.side = 'buy'
      GROUP BY tx_hash, m.condition_id, m.outcome_index
    ) b ON s.tx_hash = b.tx_hash
      AND s.condition_id = b.condition_id
      AND s.outcome_index != b.outcome_index
      AND abs(s.tokens - b.tokens) < 1
  `;

  const phantomResult = await clickhouse.query({ query: phantomQuery, format: 'JSONEachRow' });
  const phantomRows = await phantomResult.json() as Array<{tx_hash: string; condition_id: string; outcome_index: number}>;
  const phantomCount = phantomRows.length;

  // Build phantom set for filtering
  const phantomSet = new Set(phantomRows.map(r => 
    r.tx_hash + '|' + r.condition_id + '|' + r.outcome_index
  ));

  // Step 2: Calculate PnL, treating phantom sells as having 0 tokens/usdc
  // We need to pass phantom info to the query somehow
  // Option: Use a tuple list in the query with NOT IN
  
  // Build a tuple list for exclusion (limit to 10000 to avoid query size issues)
  let phantomFilter = '';
  if (phantomRows.length > 0 && phantomRows.length < 10000) {
    const tuples = phantomRows.map(r => 
      `('${r.tx_hash}', '${r.condition_id}', ${r.outcome_index})`
    ).join(', ');
    phantomFilter = `AND NOT (t.side = 'sell' AND (substring(event_id, 1, 66), m.condition_id, m.outcome_index) IN (${tuples}))`;
  }

  // Main PnL query - V17 style but with phantom filter
  const query = `
    SELECT
      status,
      count() as position_count,
      round(sum(realized_pnl), 2) as total_realized,
      round(sum(unrealized_pnl), 2) as total_unrealized
    FROM (
      SELECT
        multiIf(
          is_resolved, 'resolved',
          net_tokens = 0 OR sold_tokens >= bought_tokens, 'closed',
          'open'
        ) as status,
        multiIf(
          is_resolved,
          (if(sold_tokens > bought_tokens AND sold_tokens > 0,
              sold_proceeds * (bought_tokens / sold_tokens),
              sold_proceeds) + (net_tokens * resolution_price)) - bought_cost,
          net_tokens = 0 OR sold_tokens >= bought_tokens,
          if(sold_tokens > bought_tokens AND sold_tokens > 0,
             sold_proceeds * (bought_tokens / sold_tokens),
             sold_proceeds) - bought_cost,
          0
        ) as realized_pnl,
        multiIf(
          is_resolved, 0,
          net_tokens > 0 AND mark_price > 0,
          (net_tokens * mark_price) - (net_tokens * if(bought_tokens > 0, bought_cost / bought_tokens, 0)),
          0
        ) as unrealized_pnl
      FROM (
        SELECT
          ps.condition_id,
          ps.outcome_index,
          ps.bought_tokens,
          ps.bought_cost,
          ps.sold_tokens,
          ps.sold_proceeds,
          greatest(ps.bought_tokens - ps.sold_tokens, 0) as net_tokens,
          length(r.norm_prices) > 0 as is_resolved,
          if(length(r.norm_prices) > 0,
             arrayElement(r.norm_prices, toUInt8(ps.outcome_index + 1)),
             0.0) as resolution_price,
          coalesce(mp.mark_price, 0.0) as mark_price
        FROM (
          SELECT
            condition_id,
            outcome_index,
            sumIf(tokens, side='buy') as bought_tokens,
            sumIf(usdc, side='buy') as bought_cost,
            sumIf(tokens, side='sell') as sold_tokens,
            sumIf(usdc, side='sell') as sold_proceeds
          FROM (
            SELECT
              m.condition_id as condition_id,
              m.outcome_index as outcome_index,
              t.side as side,
              max(t.usdc_amount) / 1e6 as usdc,
              max(t.token_amount) / 1e6 as tokens
            FROM pm_trader_events_v3 t
            LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
            WHERE lower(t.trader_wallet) = '${w}'
              AND m.condition_id IS NOT NULL
              AND m.condition_id != ''
              ${phantomFilter}
            GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, t.side
          )
          GROUP BY condition_id, outcome_index
        ) ps
        LEFT JOIN pm_condition_resolutions_norm r ON lower(ps.condition_id) = lower(r.condition_id)
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(ps.condition_id) = lower(mp.condition_id)
          AND ps.outcome_index = mp.outcome_index
      )
    )
    GROUP BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as {
    status: string;
    position_count: string;
    total_realized: string;
    total_unrealized: string;
  }[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = 0;

  for (const row of rows) {
    realizedPnl += parseFloat(row.total_realized) || 0;
    unrealizedPnl += parseFloat(row.total_unrealized) || 0;
    if (row.status === 'open') openCount += parseInt(row.position_count, 10) || 0;
    else closedCount += parseInt(row.position_count, 10) || 0;
  }

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    phantomTradesExcluded: phantomCount,
    confidence: phantomCount > 100 ? 'medium' : 'high',
  };
}
