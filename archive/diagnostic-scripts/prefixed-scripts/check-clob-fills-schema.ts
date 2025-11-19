import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('clob_fills schema:\n');

  const schema = await clickhouse.query({
    query: 'DESCRIBE default.clob_fills',
    format: 'JSONEachRow'
  });

  const rows: any[] = await schema.json();
  rows.forEach(r => console.log(`  ${r.name.padEnd(30)} ${r.type}`));

  console.log('\n\nSample row:\n');

  const sample = await clickhouse.query({
    query: 'SELECT * FROM default.clob_fills LIMIT 1',
    format: 'JSONEachRow'
  });

  const sampleRows: any[] = await sample.json();
  if (sampleRows.length > 0) {
    console.log(JSON.stringify(sampleRows[0], null, 2));
  }
}

main().catch(console.error);
