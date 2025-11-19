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
  const res = await client.query({
    query: "SELECT name FROM system.tables WHERE database = 'cascadian_clean' AND name LIKE 'vw_wallet_pnl%' ORDER BY name",
    format: 'CSV'
  });
  console.log(await res.text());
  await client.close();
}

main();
