#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});
(async () => {
  const queries = [
    {
      name: 'fact_trades_clean overlap',
      sql: `SELECT count() AS total,
                   sum(condition_id_norm IN (SELECT condition_id_norm FROM default.market_resolutions_final)) AS direct_matches
            FROM default.fact_trades_clean`
    },
    {
      name: 'vw_trades_canonical overlap',
      sql: `SELECT count() AS total,
                   sum(lower(replaceAll(condition_id_norm,'0x','')) IN (SELECT lower(replaceAll(condition_id_norm,'0x','')) FROM default.market_resolutions_final)) AS matches
            FROM default.vw_trades_canonical`
    }
  ];
  for (const q of queries) {
    const res = await ch.query({ query: q.sql, format: 'JSONEachRow' });
    console.log(q.name, await res.text());
  }
  await ch.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
