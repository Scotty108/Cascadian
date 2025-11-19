import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const schema = await clickhouse.query({
    query: 'DESCRIBE clob_fills',
    format: 'JSONEachRow'
  });

  const cols: any[] = await schema.json();
  console.log('clob_fills columns:');
  cols.forEach(c => console.log(`  ${c.name.padEnd(30)} ${c.type}`));
}

main().catch(console.error);
