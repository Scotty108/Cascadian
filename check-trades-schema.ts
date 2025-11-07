#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('Checking trades_raw schema...\n');

  const schema = await client.query({
    query: `
      SELECT
        name,
        type
      FROM system.columns
      WHERE database = 'default'
        AND table = 'trades_raw'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const columns = await schema.json();
  console.log('trades_raw columns:');
  columns.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });

  console.log('\n\nSample row:');
  const sample = await client.query({
    query: `SELECT * FROM trades_raw LIMIT 1`,
    format: 'JSONEachRow'
  });
  const row = await sample.json();
  console.log(JSON.stringify(row[0], null, 2));
}

main().catch(console.error);
