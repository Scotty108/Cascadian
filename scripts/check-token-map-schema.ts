#!/usr/bin/env npx tsx
import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('Checking ctf_token_map schema...\n');

  const result = await clickhouse.query({
    query: 'DESCRIBE ctf_token_map',
    format: 'JSONEachRow'
  });
  const schema = await result.json<Array<{ name: string; type: string }>>();

  console.log('ctf_token_map columns:');
  schema.forEach(col => console.log(`   ${col.name.padEnd(30)} ${col.type}`));

  console.log('\nSample data:');
  const sampleResult = await clickhouse.query({
    query: 'SELECT * FROM ctf_token_map LIMIT 3',
    format: 'JSONEachRow'
  });
  const samples = await sampleResult.json();
  console.log(JSON.stringify(samples, null, 2));
}

main();
