import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("Checking erc1155_transfers schema...\n");

  const result = await clickhouse.query({
    query: 'DESCRIBE TABLE erc1155_transfers',
    format: 'JSONEachRow'
  });
  const schema = await result.json();

  console.log('erc1155_transfers columns:');
  console.table(schema);

  // Also get a sample row
  const sampleQuery = await clickhouse.query({
    query: 'SELECT * FROM erc1155_transfers LIMIT 1',
    format: 'JSONEachRow'
  });
  const sample = await sampleQuery.json();

  console.log('\nSample row (keys):');
  console.log(Object.keys(sample[0]));
}

main().catch(console.error);
