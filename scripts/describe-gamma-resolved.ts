#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Describing gamma_resolved:');
  const desc1 = await clickhouse.query({
    query: 'DESCRIBE gamma_resolved',
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await desc1.json(), null, 2));
  console.log('\n');
  
  console.log('Sample rows from gamma_resolved (first 3):');
  const sample1 = await clickhouse.query({
    query: 'SELECT * FROM gamma_resolved LIMIT 3',
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await sample1.json(), null, 2));
}

main().catch(console.error);
