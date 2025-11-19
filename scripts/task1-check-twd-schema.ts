#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('Checking trades_with_direction schema...\n');
  
  const result = await clickhouse.query({
    query: `SELECT * FROM default.trades_with_direction LIMIT 1`,
    format: 'JSONEachRow'
  });
  const rows = await result.json<Array<any>>();
  
  if (rows.length > 0) {
    console.log('Columns:', Object.keys(rows[0]).join(', '));
    console.log('\nSample row:', JSON.stringify(rows[0], null, 2));
  }
}

main().catch(console.error);
