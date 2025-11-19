import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Schema of gamma_resolved:\n');

  const schema = await clickhouse.query({
    query: `DESCRIBE gamma_resolved`,
    format: 'JSONEachRow'
  });

  const cols: any[] = await schema.json();
  cols.forEach(c => {
    console.log(`  ${c.name.padEnd(30)} ${c.type}`);
  });

  console.log('\nSample rows:\n');

  const sample = await clickhouse.query({
    query: `SELECT * FROM gamma_resolved LIMIT 3`,
    format: 'JSONEachRow'
  });

  const rows: any[] = await sample.json();
  console.log(JSON.stringify(rows, null, 2));

  console.log(`\nTotal rows: `);
  const count = await clickhouse.query({
    query: `SELECT count() AS cnt FROM gamma_resolved`,
    format: 'JSONEachRow'
  });
  const c: any[] = await count.json();
  console.log(c[0].cnt);
}

main().catch(console.error);
