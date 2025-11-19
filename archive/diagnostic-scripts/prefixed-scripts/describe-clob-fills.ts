import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const describeQuery = await clickhouse.query({
    query: 'DESCRIBE TABLE clob_fills',
    format: 'JSONEachRow'
  });

  const schema: any[] = await describeQuery.json();

  console.log('clob_fills schema:\n');
  for (const col of schema) {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  }

  console.log('\nSample data:\n');

  const sampleQuery = await clickhouse.query({
    query: 'SELECT * FROM clob_fills LIMIT 1',
    format: 'JSONEachRow'
  });

  const sample: any[] = await sampleQuery.json();
  console.log(JSON.stringify(sample[0], null, 2));
}

main().catch(console.error);
