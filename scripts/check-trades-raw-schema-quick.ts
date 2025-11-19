#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const result = await clickhouse.query({
    query: `DESCRIBE TABLE default.trades_raw`,
    format: 'JSONEachRow'
  });
  const schema = await result.json<Array<any>>();
  console.log('trades_raw schema:');
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });
}

main().catch(console.error);
