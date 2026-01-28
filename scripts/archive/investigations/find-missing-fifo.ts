import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // Find condition_ids in canonical but NOT in FIFO
  const missing = await client.query({
    query: `
      SELECT 
        c.condition_id,
        c.outcome_index,
        round(c.net_tokens, 2) as net_tokens,
        round(c.cash_flow, 2) as cash_flow,
        r.payout_numerators,
        r.resolved_at
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
      WHERE (c.condition_id, c.outcome_index) NOT IN (
        SELECT DISTINCT condition_id, outcome_index
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${wallet}'
      )
      ORDER BY abs(c.cash_flow) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  
  console.log('Top 20 positions MISSING from FIFO:');
  const rows = await missing.json() as any[];
  let totalMissingCash = 0;
  for (const r of rows) {
    const resolved = r.resolved_at && r.resolved_at > '1970-01-02' ? 'RESOLVED' : 'OPEN';
    console.log('  ' + String(r.condition_id).slice(0,10) + ' oi=' + r.outcome_index + 
      ' tokens=' + r.net_tokens + ' cash=$' + r.cash_flow + ' ' + resolved);
    totalMissingCash += Number(r.cash_flow || 0);
  }
  console.log('\nTotal missing cash flow: $' + totalMissingCash.toFixed(2));
  
  // Check FIFO cron - what criteria does it use?
  // FIFO only processes RESOLVED conditions
  const resolvedStatus = await client.query({
    query: `
      SELECT 
        CASE WHEN r.resolved_at > '1970-01-02' THEN 'resolved' ELSE 'unresolved' END as status,
        count(DISTINCT (c.condition_id, c.outcome_index)) as positions,
        round(sum(c.cash_flow), 2) as cash_flow
      FROM (
        SELECT 
          condition_id, outcome_index,
          sum(usdc_delta) as cash_flow
        FROM (
          SELECT fill_id, any(condition_id) as condition_id, any(outcome_index) as outcome_index,
                 any(usdc_delta) as usdc_delta
          FROM pm_canonical_fills_v4
          WHERE wallet = '${wallet}'
          GROUP BY fill_id
        )
        GROUP BY condition_id, outcome_index
      ) c
      LEFT JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
      GROUP BY status
    `,
    format: 'JSONEachRow'
  });
  console.log('\nResolution status breakdown:');
  for (const r of await resolvedStatus.json() as any[]) {
    console.log('  ' + r.status + ': ' + r.positions + ' positions, cash=$' + r.cash_flow);
  }
  
  process.exit(0);
}
check();
