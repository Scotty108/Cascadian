#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Describing clob_fills:');
  const desc = await clickhouse.query({
    query: 'DESCRIBE clob_fills',
    format: 'JSONEachRow'
  });
  const schema: any[] = await desc.json();
  console.log('Columns:', schema.map(c => c.name).join(', '));
  console.log('\nFull schema:');
  console.log(JSON.stringify(schema, null, 2));
  
  console.log('\n\nSample row:');
  const sample = await clickhouse.query({
    query: 'SELECT * FROM clob_fills LIMIT 1',
    format: 'JSONEachRow'
  });
  console.log(JSON.stringify(await sample.json(), null, 2));
}

main().catch(console.error);
