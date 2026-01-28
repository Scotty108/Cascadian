import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // V1-style calculation
  const v1Calc = await client.query({
    query: `
      SELECT 
        round(sum(cash_flow), 2) as total_cash_flow,
        round(sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as resolution_payouts,
        round(sum(cash_flow) + sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as total_pnl
      FROM (
        SELECT 
          cid as condition_id,
          oi as outcome_index,
          sum(td) as net_tokens,
          sum(ud) as cash_flow,
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
          GROUP BY fill_id
        )
        GROUP BY cid, oi
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('V1-style calculation:', (await v1Calc.json())[0]);
  console.log('PM shows: $8,713.51 PnL');
  console.log('Gap: $' + (8713.51 - 1810.89).toFixed(2));
  
  // What if we calculate volume including redemptions?
  const volumeWithRedemptions = await client.query({
    query: `
      SELECT 
        round(sum(abs(cash_flow)), 2) as trading_volume,
        round(sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as redemption_volume,
        round(sum(abs(cash_flow)) + sum(CASE WHEN net_tokens > 0 AND payout_rate > 0 THEN net_tokens * payout_rate ELSE 0 END), 2) as total_volume
      FROM (
        SELECT 
          cid, oi,
          sum(td) as net_tokens,
          sum(ud) as cash_flow,
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
          GROUP BY fill_id
        )
        GROUP BY cid, oi
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('\nVolume with redemptions:', (await volumeWithRedemptions.json())[0]);
  console.log('PM shows: $39,513.98 volume');
  
  process.exit(0);
}
check();
