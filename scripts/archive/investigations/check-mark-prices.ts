import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // Check if unresolved positions have mark prices
  const markPrices = await client.query({
    query: `
      SELECT 
        c.condition_id,
        c.outcome_index,
        round(c.net_tokens, 2) as net_tokens,
        round(c.cash_flow, 2) as cash_flow,
        r.payout_numerators,
        mp.mark_price,
        CASE
          WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN 'realized'
          WHEN mp.mark_price IS NOT NULL AND (mp.mark_price <= 0.01 OR mp.mark_price >= 0.99) THEN 'synthetic'
          WHEN mp.mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as v1_status
      FROM (
        SELECT 
          condition_id, outcome_index,
          sum(tokens_delta) as net_tokens,
          sum(usdc_delta) as cash_flow
        FROM (
          SELECT fill_id, any(condition_id) as condition_id, any(outcome_index) as outcome_index,
                 any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta
          FROM pm_canonical_fills_v4
          WHERE wallet = '${wallet}'
          GROUP BY fill_id
        )
        GROUP BY condition_id, outcome_index
      ) c
      LEFT JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(c.condition_id) = lower(mp.condition_id) AND c.outcome_index = mp.outcome_index
      WHERE r.payout_numerators IS NULL OR r.payout_numerators = ''
      ORDER BY abs(c.cash_flow) DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });
  
  console.log('Unresolved positions and their V1 status:');
  const rows = await markPrices.json() as any[];
  let unknownCash = 0;
  for (const r of rows) {
    console.log('  ' + String(r.condition_id).slice(0,10) + ' oi=' + r.outcome_index + 
      ' tokens=' + r.net_tokens + ' cash=$' + r.cash_flow + 
      ' mark=' + (r.mark_price || 'NULL') + ' -> ' + r.v1_status);
    if (r.v1_status === 'unknown') {
      unknownCash += Number(r.cash_flow || 0);
    }
  }
  console.log('\nTotal "unknown" status cash being DROPPED: $' + unknownCash.toFixed(2));
  
  process.exit(0);
}
check();
