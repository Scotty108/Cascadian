import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const schema = await ch.query({
    query: `DESCRIBE default.staging_resolutions_union`,
    format: 'JSONEachRow',
  });

  const cols = await schema.json() as Array<{ name: string; type: string }>;
  console.log('\nstaging_resolutions_union schema:');
  cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

  const sample = await ch.query({
    query: `SELECT * FROM default.staging_resolutions_union LIMIT 3`,
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log('\nSample rows:');
  console.log(JSON.stringify(rows, null, 2));

  await ch.close();
}

main().catch(console.error);
