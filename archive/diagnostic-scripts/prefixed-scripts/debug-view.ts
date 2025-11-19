import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  // Check view definition
  console.log('1. View definition:');
  const viewDef = await clickhouse.query({
    query: "SHOW CREATE TABLE ctf_token_decoded",
    format: 'JSONEachRow'
  });
  const def = await viewDef.json();
  console.log(def[0].statement);
  console.log();

  // Try to get count differently
  console.log('2. Getting count...');
  const countResult = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_decoded',
    format: 'JSONEachRow'
  });
  const countData = await countResult.json();
  console.log('Raw result:', countData);
  console.log('Count value:', countData[0]);
  console.log();

  // Sample 5 rows
  console.log('3. Sample data:');
  const sample = await clickhouse.query({
    query: 'SELECT * FROM ctf_token_decoded LIMIT 5',
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();
  console.log(JSON.stringify(sampleData, null, 2));
}

main().catch(console.error);
