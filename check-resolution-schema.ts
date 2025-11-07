#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('Checking market_resolutions_final schema...\n');

  const schema = await client.query({
    query: `
      SELECT
        name,
        type,
        comment
      FROM system.columns
      WHERE database = 'default'
        AND table = 'market_resolutions_final'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const columns = await schema.json();
  console.log('market_resolutions_final columns:');
  columns.forEach((col: any) => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });

  console.log('\n\nSample row:');
  const sample = await client.query({
    query: `SELECT * FROM market_resolutions_final LIMIT 1`,
    format: 'JSONEachRow'
  });
  const row = await sample.json();
  console.log(JSON.stringify(row[0], null, 2));

  console.log('\n\nRow count:');
  const count = await client.query({
    query: `SELECT count() as cnt FROM market_resolutions_final`,
    format: 'JSONEachRow'
  });
  const cnt = await count.json();
  console.log('Total rows:', cnt[0].cnt);
}

main().catch(console.error);
