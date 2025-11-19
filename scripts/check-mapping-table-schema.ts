#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\nChecking token_condition_market_map schema...\n');

  const schema = await ch.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'cascadian_clean'
        AND table = 'token_condition_market_map'
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });
  const cols = await schema.json<any[]>();

  console.log('Columns in token_condition_market_map:');
  cols.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });
  console.log('');

  // Sample some data
  const sample = await ch.query({
    query: `SELECT * FROM cascadian_clean.token_condition_market_map LIMIT 3`,
    format: 'JSONEachRow',
  });
  const data = await sample.json<any[]>();

  console.log('Sample rows:');
  data.forEach((row, i) => {
    console.log(`\n${i + 1}.`);
    Object.keys(row).forEach(key => {
      const val = row[key];
      if (typeof val === 'string' && val.length > 40) {
        console.log(`  ${key}: ${val.substring(0, 40)}...`);
      } else {
        console.log(`  ${key}: ${val}`);
      }
    });
  });

  await ch.close();
}

main().catch(console.error);
