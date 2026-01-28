import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // FIFO breakdown
  const fifo = await client.query({
    query: `
      SELECT 
        round(sum(cost_usd), 2) as total_cost,
        round(sum(exit_value), 2) as total_exit,
        round(sum(pnl_usd), 2) as total_pnl,
        count() as positions
      FROM (
        SELECT condition_id, outcome_index, entry_time,
          any(cost_usd) as cost_usd,
          any(exit_value) as exit_value,
          any(pnl_usd) as pnl_usd
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${wallet}'
        GROUP BY condition_id, outcome_index, entry_time
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('FIFO summary:', (await fifo.json())[0]);
  
  // Simple cash flow calculation
  const cashFlow = await client.query({
    query: `
      SELECT 
        round(sumIf(ud, ud < 0), 2) as cash_spent,
        round(sumIf(ud, ud > 0), 2) as cash_received,
        round(sum(ud), 2) as net_cash_flow
      FROM (
        SELECT fill_id, any(usdc_delta) as ud
        FROM pm_canonical_fills_v4
        WHERE wallet = '${wallet}'
        GROUP BY fill_id
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('\nCanonical fills cash flow:', (await cashFlow.json())[0]);
  
  // Check if FIFO only has RESOLVED positions
  const fifoResolved = await client.query({
    query: `
      SELECT 
        countIf(resolved_at > '1970-01-02') as resolved,
        countIf(resolved_at <= '1970-01-02' OR resolved_at IS NULL) as unresolved
      FROM (
        SELECT condition_id, outcome_index, entry_time, any(resolved_at) as resolved_at
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${wallet}'
        GROUP BY condition_id, outcome_index, entry_time
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('\nFIFO resolved status:', (await fifoResolved.json())[0]);
  
  // Check what markets are in canonical but NOT in FIFO
  const missingFromFifo = await client.query({
    query: `
      SELECT count(DISTINCT (condition_id, outcome_index)) as positions_in_canonical
      FROM (
        SELECT fill_id, any(condition_id) as condition_id, any(outcome_index) as outcome_index
        FROM pm_canonical_fills_v4
        WHERE wallet = '${wallet}'
        GROUP BY fill_id
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('\nPositions in canonical_fills:', (await missingFromFifo.json())[0]);
  console.log('Positions in FIFO: 29');
  
  process.exit(0);
}
check();
