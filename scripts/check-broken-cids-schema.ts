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
  const result = await client.query({
    query: 'DESCRIBE TABLE cascadian_clean.fact_trades_BROKEN_CIDS',
    format: 'JSONEachRow',
  });

  const rows = await result.json<Array<{ name: string; type: string }>>();
  console.log('fact_trades_BROKEN_CIDS schema:');
  rows.forEach(r => console.log(`  ${r.name}: ${r.type}`));

  console.log('\nSample data:');
  const sample = await client.query({
    query: 'SELECT * FROM cascadian_clean.fact_trades_BROKEN_CIDS LIMIT 3',
    format: 'JSONEachRow',
  });
  const data = await sample.json();
  console.log(JSON.stringify(data, null, 2));

  await client.close();
}

main().catch(console.error);
