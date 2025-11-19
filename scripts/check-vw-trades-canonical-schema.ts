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

async function checkSchema() {
  console.log('Checking vw_trades_canonical schema...\n');

  const result = await client.query({
    query: 'DESCRIBE TABLE default.vw_trades_canonical',
    format: 'JSONEachRow',
  });

  const schema = await result.json<Array<{name: string, type: string}>>();

  console.log('Columns:');
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  }

  console.log('\nSample row:');
  const sample = await client.query({
    query: 'SELECT * FROM default.vw_trades_canonical LIMIT 1',
    format: 'JSONEachRow',
  });

  const row = (await sample.json<Array<any>>())[0];
  console.log(JSON.stringify(row, null, 2));

  await client.close();
}

checkSchema().catch(console.error);
