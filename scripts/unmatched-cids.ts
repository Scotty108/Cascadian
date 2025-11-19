#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({ host: process.env.CLICKHOUSE_HOST!, username: process.env.CLICKHOUSE_USER!, password: process.env.CLICKHOUSE_PASSWORD! });

async function main() {
  const sql = `
    SELECT cid
    FROM (
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
      FROM default.vw_trades_canonical
    ) t
    LEFT JOIN (
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
      FROM default.market_resolutions_final
      UNION ALL
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) AS cid
      FROM default.resolutions_external_ingest
    ) r ON t.cid = r.cid
    WHERE r.cid IS NULL
    LIMIT 5
  `;
  const res = await client.query({ query: sql, format: 'JSONEachRow' });
  console.log(await res.text());
  await client.close();
}

main().catch(async (err) => {
  console.error(err);
  await client.close();
  process.exit(1);
});
