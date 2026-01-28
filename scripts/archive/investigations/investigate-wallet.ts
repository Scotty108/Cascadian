import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // Check canonical fills by source
  const sources = await client.query({
    query: `
      SELECT source, count() as fills, 
             round(sum(abs(usdc_delta)), 2) as volume,
             round(sum(usdc_delta), 2) as net_flow
      FROM (
        SELECT fill_id, any(source) as source, any(usdc_delta) as usdc_delta
        FROM pm_canonical_fills_v4
        WHERE wallet = '${wallet}'
        GROUP BY fill_id
      )
      GROUP BY source
      ORDER BY fills DESC
    `,
    format: 'JSONEachRow'
  });
  console.log('Canonical fills by source:');
  for (const r of await sources.json() as any[]) {
    console.log('  ' + r.source + ': ' + r.fills + ' fills, vol=$' + r.volume + ', net=$' + r.net_flow);
  }
  
  // Our total volume vs PM
  const totalVol = await client.query({
    query: `
      SELECT round(sum(abs(ud)), 2) as our_volume, count() as fills
      FROM (
        SELECT fill_id, any(usdc_delta) as ud
        FROM pm_canonical_fills_v4
        WHERE wallet = '${wallet}'
        GROUP BY fill_id
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('\nOur volume:', (await totalVol.json())[0]);
  console.log('PM volume: $39,513.98');
  
  // FIFO summary
  const fifo = await client.query({
    query: `
      SELECT 
        round(sum(pnl), 2) as fifo_pnl,
        count() as positions
      FROM (
        SELECT condition_id, outcome_index, entry_time, any(pnl_usd) as pnl
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${wallet}'
        GROUP BY condition_id, outcome_index, entry_time
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('\nFIFO PnL:', (await fifo.json())[0]);
  
  // Check unique markets
  const markets = await client.query({
    query: `
      SELECT count(DISTINCT condition_id) as unique_markets
      FROM (
        SELECT fill_id, any(condition_id) as condition_id
        FROM pm_canonical_fills_v4
        WHERE wallet = '${wallet}'
        GROUP BY fill_id
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('Our unique markets:', (await markets.json())[0]);
  console.log('PM shows: 47 markets');
  
  process.exit(0);
}
check();
