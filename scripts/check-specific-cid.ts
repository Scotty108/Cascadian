#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
const client = createClient({ host: process.env.CLICKHOUSE_HOST!, username: process.env.CLICKHOUSE_USER!, password: process.env.CLICKHOUSE_PASSWORD! });
async function main() {
  const cid = 'b64a2c02b6342ca71e03effcb6b9730a54f56250067bb36708ea3040a7f386e2';
  const sql = `
    SELECT r.cid, toTypeName(r.cid) AS type
    FROM (
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
      FROM default.vw_trades_canonical
      WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${cid}'
    ) t
    LEFT JOIN (
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) AS cid
      FROM default.market_resolutions_final
      UNION ALL
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) AS cid
      FROM default.resolutions_external_ingest
    ) r ON t.cid = r.cid
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
