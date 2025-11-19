import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("Checking ctf_token_map schema...\n");

  const schema = await clickhouse.query({
    query: 'DESCRIBE TABLE ctf_token_map',
    format: 'JSONEachRow'
  });
  const cols = await schema.json();

  console.log('Columns:');
  console.table(cols.map((c: any) => ({ name: c.name, type: c.type })));

  const sample = await clickhouse.query({
    query: 'SELECT * FROM ctf_token_map LIMIT 1',
    format: 'JSONEachRow'
  });

  console.log('\nSample row:');
  console.log(JSON.stringify(await sample.json(), null, 2));
}

main().catch(console.error);
