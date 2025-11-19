#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
const client = createClient({ host: process.env.CLICKHOUSE_HOST!, username: process.env.CLICKHOUSE_USER!, password: process.env.CLICKHOUSE_PASSWORD! });
async function main() {
  const sql = `
    SELECT count(*) AS cnt
    FROM default.market_resolutions_final
    WHERE condition_id_norm LIKE 'b64a%'
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
