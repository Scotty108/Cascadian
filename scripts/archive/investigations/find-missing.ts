import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function check() {
  const client = getClickHouseClient();
  const wallet = '0x35cb563c1e59daa39afb153df25b3462473893ad';
  
  // Check pm_trader_events_v2 (maybe more fills there?)
  const traderEvents = await client.query({
    query: `
      SELECT count(DISTINCT event_id) as unique_events,
             round(sum(abs(usdc_amount)) / 1e6, 2) as volume
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  console.log('pm_trader_events_v2:', (await traderEvents.json())[0]);
  
  // Check CTF split/merge
  const ctf = await client.query({
    query: `
      SELECT count() as events
      FROM pm_ctf_split_merge_expanded
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  console.log('pm_ctf_split_merge_expanded:', (await ctf.json())[0]);
  
  // Check if there are fills with source != 'clob'
  const otherSources = await client.query({
    query: `
      SELECT source, count() as cnt
      FROM pm_canonical_fills_v4
      WHERE wallet = '${wallet}'
      GROUP BY source
    `,
    format: 'JSONEachRow'
  });
  console.log('\nAll sources in canonical_fills:');
  for (const r of await otherSources.json() as any[]) {
    console.log('  ' + r.source + ': ' + r.cnt);
  }
  
  // Check if maybe we need to look at the maker side too
  // PM might count both maker AND taker for the same trade
  const makerTaker = await client.query({
    query: `
      SELECT 
        is_maker,
        count() as cnt,
        round(sum(abs(usdc_delta)), 2) as volume
      FROM (
        SELECT fill_id, any(is_maker) as is_maker, any(usdc_delta) as usdc_delta
        FROM pm_canonical_fills_v4
        WHERE wallet = '${wallet}'
        GROUP BY fill_id
      )
      GROUP BY is_maker
    `,
    format: 'JSONEachRow'
  });
  console.log('\nMaker vs Taker breakdown:');
  for (const r of await makerTaker.json() as any[]) {
    console.log('  is_maker=' + r.is_maker + ': ' + r.cnt + ' fills, vol=$' + r.volume);
  }
  
  process.exit(0);
}
check();
