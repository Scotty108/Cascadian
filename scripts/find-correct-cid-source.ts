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
  console.log('Searching for tables with condition_id data...\n');

  // Check vw_trades_canonical
  const canonical = await client.query({
    query: 'DESCRIBE TABLE default.vw_trades_canonical',
    format: 'JSONEachRow',
  });
  const canonicalCols = await canonical.json<Array<{ name: string }>>();
  console.log('vw_trades_canonical columns:');
  canonicalCols.forEach(c => console.log(`  ${c.name}`));

  console.log('\nSample from vw_trades_canonical:');
  const canonicalSample = await client.query({
    query: 'SELECT * FROM default.vw_trades_canonical LIMIT 2',
    format: 'JSONEachRow',
  });
  const canonicalData = await canonicalSample.json();
  console.log(JSON.stringify(canonicalData, null, 2));

  await client.close();
}

main().catch(console.error);
