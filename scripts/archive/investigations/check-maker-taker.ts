import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // Check what happens if we DON'T exclude self-fill makers
  const withSelfFills = await client.query({
    query: `
      SELECT 
        round(sum(cash_flow), 2) as total_cash_flow,
        round(sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as resolution_payouts,
        round(sum(cash_flow) + sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as total_pnl,
        sum(fills) as total_fills
      FROM (
        SELECT 
          cid, oi,
          sum(td) as net_tokens,
          sum(ud) as cash_flow,
          count() as fills,
          CASE
            WHEN any(pn) = '[1,1]' THEN 0.5
            WHEN any(pn) = '[0,1]' AND oi = 1 THEN 1.0
            WHEN any(pn) = '[1,0]' AND oi = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate
        FROM (
          SELECT fill_id, 
                 any(tokens_delta) as td,
                 any(usdc_delta) as ud,
                 any(condition_id) as cid, 
                 any(outcome_index) as oi,
                 any(r.payout_numerators) as pn
          FROM pm_canonical_fills_v4 f
          LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.wallet = '${wallet}'
            -- NO self-fill filter!
          GROUP BY fill_id
        )
        GROUP BY cid, oi
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('WITHOUT self-fill exclusion:', (await withSelfFills.json())[0]);
  
  // Check what V1 engine filters
  const withV1Filters = await client.query({
    query: `
      SELECT 
        round(sum(cash_flow), 2) as total_cash_flow,
        round(sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as resolution_payouts,
        round(sum(cash_flow) + sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as total_pnl,
        sum(fills) as total_fills
      FROM (
        SELECT 
          cid, oi,
          sum(td) as net_tokens,
          sum(ud) as cash_flow,
          count() as fills,
          CASE
            WHEN any(pn) = '[1,1]' THEN 0.5
            WHEN any(pn) = '[0,1]' AND oi = 1 THEN 1.0
            WHEN any(pn) = '[1,0]' AND oi = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate
        FROM (
          SELECT fill_id, 
                 any(tokens_delta) as td,
                 any(usdc_delta) as ud,
                 any(condition_id) as cid, 
                 any(outcome_index) as oi,
                 any(r.payout_numerators) as pn
          FROM pm_canonical_fills_v4 f
          LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.wallet = '${wallet}'
            AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)  -- V1 filter
            AND f.source != 'negrisk'  -- V1 filter
          GROUP BY fill_id
        )
        GROUP BY cid, oi
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('WITH V1 filters (self-fill + negrisk):', (await withV1Filters.json())[0]);
  
  // Check if negrisk source is the culprit
  const onlyNegrisk = await client.query({
    query: `
      SELECT count() as negrisk_fills, round(sum(usdc_delta), 2) as negrisk_cash
      FROM pm_canonical_fills_v4
      WHERE wallet = '${wallet}' AND source = 'negrisk'
    `,
    format: 'JSONEachRow'
  });
  console.log('\nNegrisk fills:', (await onlyNegrisk.json())[0]);
  
  process.exit(0);
}
check();
