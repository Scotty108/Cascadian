#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const client = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  const sql = `
    SELECT condition_id_norm
    FROM default.vw_trades_canonical
    WHERE wallet_address_norm = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad'
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
