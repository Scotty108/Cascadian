#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function check() {
  console.log('\n📋 trades_raw schema:');
  const schema = await client.query({
    query: `DESCRIBE TABLE trades_raw`,
    format: 'JSONEachRow',
  });
  const cols = await schema.json();
  cols.forEach((c: any) => console.log(`  ${c.name.padEnd(30)} ${c.type}`));
  
  console.log('\n📊 Sample data:');
  const sample = await client.query({
    query: `SELECT * FROM trades_raw LIMIT 3`,
    format: 'JSONEachRow',
  });
  console.log(await sample.json());
  
  await client.close();
}

check().catch(console.error);
