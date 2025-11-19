#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Checking pm_trades view...');

  const query = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_trades',
    format: 'JSONEachRow'
  });
  const schema = await query.json();
  console.table(schema);

  const sampleQuery = await clickhouse.query({
    query: 'SELECT * FROM pm_trades LIMIT 1',
    format: 'JSONEachRow'
  });
  const sample = await sampleQuery.json();
  console.log('Sample row:');
  console.log(JSON.stringify(sample, null, 2));
}

main().catch(console.error);
