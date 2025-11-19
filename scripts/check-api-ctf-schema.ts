import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n=== api_ctf_bridge ===');
  
  const schema = await ch.query({
    query: `DESCRIBE default.api_ctf_bridge`,
    format: 'JSONEachRow',
  });

  const cols = await schema.json() as Array<{ name: string; type: string }>;
  console.log('\nColumns:');
  cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

  const sample = await ch.query({
    query: `SELECT * FROM default.api_ctf_bridge WHERE winning_index >= 0 LIMIT 2`,
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log('\nSample rows:');
  console.log(JSON.stringify(rows, null, 2));

  console.log('\n=== resolutions_src_api ===');
  
  const schema2 = await ch.query({
    query: `DESCRIBE cascadian_clean.resolutions_src_api`,
    format: 'JSONEachRow',
  });

  const cols2 = await schema2.json() as Array<{ name: string; type: string }>;
  console.log('\nColumns:');
  cols2.forEach(c => console.log(`  ${c.name}: ${c.type}`));

  const sample2 = await ch.query({
    query: `SELECT * FROM cascadian_clean.resolutions_src_api WHERE resolved = 1 LIMIT 2`,
    format: 'JSONEachRow',
  });

  const rows2 = await sample2.json();
  console.log('\nSample rows:');
  console.log(JSON.stringify(rows2, null, 2));

  await ch.close();
}

main().catch(console.error);
