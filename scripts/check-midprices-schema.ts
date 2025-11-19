#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || ''
});

async function main() {
  console.log('cascadian_clean.midprices_latest schema:');
  const schema = await client.query({
    query: `DESCRIBE cascadian_clean.midprices_latest`,
    format: 'JSONEachRow'
  });
  const cols = await schema.json();
  console.log(cols.map((c: any) => `${c.name}: ${c.type}`).join('\n'));
  
  console.log('\n\nSample data:');
  const sample = await client.query({
    query: `SELECT * FROM cascadian_clean.midprices_latest LIMIT 3`,
    format: 'JSONEachRow'
  });
  const data = await sample.json();
  console.log(JSON.stringify(data, null, 2));
  
  await client.close();
}

main().catch(console.error);
