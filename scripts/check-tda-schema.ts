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

async function checkSchema() {
  const result = await client.query({
    query: 'DESCRIBE trade_direction_assignments',
    format: 'JSONEachRow',
  });
  console.log('trade_direction_assignments schema:');
  console.log(await result.json());
  await client.close();
}

checkSchema().catch(console.error);
