#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const result = await clickhouse.query({
    query: `DESCRIBE TABLE default.trades_with_direction`,
    format: 'JSONEachRow'
  });
  const schema = await result.json<Array<any>>();
  console.log('trades_with_direction schema:');
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}`);
  });
}

main().catch(console.error);
