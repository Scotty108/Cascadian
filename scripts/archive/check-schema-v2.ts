#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function main() {
  console.log('vw_trades_canonical schema:');
  const schema = await client.query({
    query: `DESCRIBE vw_trades_canonical`,
    format: 'JSONEachRow'
  });
  const cols = await schema.json();
  console.log(cols.map((c: any) => `${c.name}: ${c.type}`).join('\n'));
  
  console.log('\n\nmarket_resolutions_final schema:');
  const resSchema = await client.query({
    query: `DESCRIBE market_resolutions_final`,
    format: 'JSONEachRow'
  });
  const resCols = await resSchema.json();
  console.log(resCols.map((c: any) => `${c.name}: ${c.type}`).join('\n'));
  
  await client.close();
}

main().catch(console.error);
