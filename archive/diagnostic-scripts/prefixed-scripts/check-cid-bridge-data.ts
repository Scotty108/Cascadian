import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Checking cid_bridge data...\n');

  // Get all data for a specific CTF ID
  const query = await clickhouse.query({
    query: `
      SELECT *
      FROM cid_bridge
      WHERE condition_id_ctf LIKE '9f37e89c6646%'
    `,
    format: 'JSONEachRow'
  });

  const results = await query.json();

  console.log(`Found ${results.length} rows\n`);

  results.forEach((r: any) => {
    console.log('Row data:');
    console.log(JSON.stringify(r, null, 2));
  });

  // Also check the view definition
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('Checking cid_bridge view definition...\n');

  const viewQuery = await clickhouse.query({
    query: `
      SHOW CREATE TABLE cid_bridge
    `,
    format: 'JSONEachRow'
  });

  const viewDef = await viewQuery.json();
  console.log(viewDef[0].statement);
}

main().catch(console.error);
