import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const schema = await ch.query({
    query: `DESCRIBE cascadian_clean.resolutions_src_api`,
    format: 'JSONEachRow',
  });

  const cols = await schema.json() as Array<{ name: string; type: string }>;
  console.log('\nresolutions_src_api columns:');
  cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

  const sample = await ch.query({
    query: `SELECT * FROM cascadian_clean.resolutions_src_api WHERE resolved = 1 LIMIT 2`,
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log('\nSample rows:');
  console.log(JSON.stringify(rows, null, 2));

  await ch.close();
}

main().catch(console.error);
