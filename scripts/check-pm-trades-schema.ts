#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: 'DESCRIBE pm_trades',
    format: 'JSONEachRow'
  });

  const schema = await result.json();
  console.log('pm_trades schema:');
  console.table(schema);

  // Also show a sample row
  const sampleResult = await clickhouse.query({
    query: 'SELECT * FROM pm_trades LIMIT 1',
    format: 'JSONEachRow'
  });

  const sample = await sampleResult.json();
  console.log('\nSample row:');
  console.log(JSON.stringify(sample[0], null, 2));
}

main().catch(console.error);
