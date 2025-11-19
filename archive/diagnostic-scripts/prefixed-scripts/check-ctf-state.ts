import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  // Check table exists and row count
  console.log('1. Checking ctf_token_map table...');
  const count = await clickhouse.query({
    query: 'SELECT count(*) as count FROM ctf_token_map',
    format: 'JSONEachRow'
  });
  const countResult = await count.json();
  console.log('Row count:', countResult[0].count);

  // Check if view exists
  console.log('\n2. Checking ctf_token_decoded view...');
  const viewExists = await clickhouse.query({
    query: `SELECT count(*) as count FROM system.tables WHERE database = 'default' AND name = 'ctf_token_decoded'`,
    format: 'JSONEachRow'
  });
  const viewResult = await viewExists.json();
  console.log('View exists:', viewResult[0].count > 0);

  // Sample from view if it exists
  if (viewResult[0].count > 0) {
    console.log('\n3. Sampling from view...');
    const sample = await clickhouse.query({
      query: 'SELECT * FROM ctf_token_decoded LIMIT 5',
      format: 'JSONEachRow'
    });
    const sampleResult = await sample.json();
    console.log(JSON.stringify(sampleResult, null, 2));
  }

  // Check clob_fills structure
  console.log('\n4. Checking clob_fills for asset_id column...');
  const columns = await clickhouse.query({
    query: `SELECT name, type FROM system.columns WHERE database = 'default' AND table = 'clob_fills' AND name LIKE '%asset%'`,
    format: 'JSONEachRow'
  });
  const columnsResult = await columns.json();
  console.log('Asset-related columns:', columnsResult);
}

main().catch(console.error);
