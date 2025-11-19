import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Checking api_ctf_bridge schema:\n');

  const schema = await clickhouse.query({
    query: `DESCRIBE api_ctf_bridge`,
    format: 'JSONEachRow'
  });

  const cols: any[] = await schema.json();
  cols.forEach(c => {
    console.log(`  ${c.name.padEnd(30)} ${c.type}`);
  });

  console.log('\nSample rows:\n');

  const sample = await clickhouse.query({
    query: `SELECT * FROM api_ctf_bridge LIMIT 3`,
    format: 'JSONEachRow'
  });

  const rows: any[] = await sample.json();
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
