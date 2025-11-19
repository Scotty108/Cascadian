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

async function checkSchema() {
  const schema = await client.query({
    query: `DESCRIBE trades_raw`,
    format: 'JSONEachRow'
  });
  const cols = await schema.json();
  console.log('trades_raw columns:');
  cols.forEach((c: any) => console.log(`  ${c.name}: ${c.type}`));
  await client.close();
}

checkSchema();
