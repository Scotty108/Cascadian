#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  const schema = await client.query({
    query: 'DESCRIBE default.trades_raw_enriched_final',
    format: 'JSONEachRow',
  });

  const columns = await schema.json<Array<{ name: string; type: string }>>();

  console.log('trades_raw_enriched_final schema:');
  console.log();
  columns.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });

  await client.close();
}

main().catch(console.error);
