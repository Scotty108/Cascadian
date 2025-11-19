import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Checking erc1155_transfers schema...\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE TABLE erc1155_transfers`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();

  console.log('erc1155_transfers schema:');
  schema.forEach(col => {
    console.log(`   ${col.name.padEnd(30)} ${col.type}`);
  });

  console.log('\nSample data:');
  const sampleQuery = await clickhouse.query({
    query: `SELECT * FROM erc1155_transfers LIMIT 5`,
    format: 'JSONEachRow'
  });

  const sample: any[] = await sampleQuery.json();
  if (sample.length > 0) {
    console.log(JSON.stringify(sample[0], null, 2));
  }
}

main().catch(console.error);
