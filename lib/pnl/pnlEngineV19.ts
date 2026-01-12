/**
 * PnL Engine V19 - Selective Capping (Two-Step)
 * V17 over-caps. V19 only caps when NO complementary outcome in condition.
 * @version 19.0.0
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV19 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  complementCount: number;
  confidence: 'high' | 'medium' | 'low';
}

export async function getWalletPnLV19(wallet: string): Promise<PnLResultV19> {
  const w = wallet.toLowerCase();

  // Step 1: Find outcomes where sold>bought but condition has complementary outcome
  const complementQuery = `
    SELECT condition_id, outcome_index
    FROM (
      SELECT
        condition_id,
        outcome_index,
        bought - sold as net,
        sum(if(bought > sold, 1, 0)) OVER (PARTITION BY condition_id) as positive_count
      FROM (
        SELECT
          condition_id,
          outcome_index,
          sumIf(tokens, side='buy') as bought,
          sumIf(tokens, side='sell') as sold
        FROM (
          SELECT
            m.condition_id as condition_id,
            m.outcome_index as outcome_index,
            t.side as side,
            max(t.token_amount) / 1e6 as tokens
          FROM pm_trader_events_v3 t
          LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE lower(t.trader_wallet) = '${w}'
            AND m.condition_id IS NOT NULL AND m.condition_id != ''
          GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, t.side
        )
        GROUP BY condition_id, outcome_index
      )
    )
    WHERE net < 0 AND positive_count > 0
  `;

  const complementResult = await clickhouse.query({ query: complementQuery, format: 'JSONEachRow' });
  const complementRows = await complementResult.json() as Array<{condition_id: string; outcome_index: number}>;
  
  // Build the no-cap filter
  let noCapFilter = '';
  if (complementRows.length > 0 && complementRows.length < 5000) {
    const tuples = complementRows.map(r => 
      `('${r.condition_id}', ${r.outcome_index})`
    ).join(', ');
    noCapFilter = `(ps.condition_id, ps.outcome_index) IN (${tuples})`;
  }

  // Main query with selective capping
  const capCondition = noCapFilter 
    ? `ps.sold_tokens > ps.bought_tokens AND ps.sold_tokens > 0 AND NOT (${noCapFilter})`
    : `ps.sold_tokens > ps.bought_tokens AND ps.sold_tokens > 0`;

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
          (effective_sell + (net_tokens * resolution_price)) - bought_cost,
          net_tokens = 0 OR sold_tokens >= bought_tokens,
          effective_sell - bought_cost,
          0
        ) as realized_pnl,
        multiIf(
          is_resolved, 0,
          net_tokens > 0 AND mark_price > 0,
          (net_tokens * mark_price) - (net_tokens * avg_cost),
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
          if(ps.bought_tokens > 0, ps.bought_cost / ps.bought_tokens, 0) as avg_cost,
          length(r.norm_prices) > 0 as is_resolved,
          if(length(r.norm_prices) > 0,
             arrayElement(r.norm_prices, toUInt8(ps.outcome_index + 1)),
             toFloat64(0)) as resolution_price,
          coalesce(mp.mark_price, toFloat64(0)) as mark_price,
          if(
            ${capCondition},
            ps.sold_proceeds * (ps.bought_tokens / ps.sold_tokens),
            ps.sold_proceeds
          ) as effective_sell
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
              AND m.condition_id IS NOT NULL AND m.condition_id != ''
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
    complementCount: complementRows.length,
    confidence: complementRows.length > 20 ? 'medium' : 'high',
  };
}
