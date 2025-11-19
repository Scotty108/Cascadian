import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Testing cid_bridge with simple query...\n');

  // Just get first 5 rows
  const query = await clickhouse.query({
    query: `SELECT condition_id_ctf, condition_id_market FROM cid_bridge LIMIT 5`,
    format: 'JSONEachRow'
  });

  const results: any[] = await query.json();

  console.log(`Got ${results.length} results\n`);

  results.forEach((r, i) => {
    console.log(`${i + 1}.`);
    console.log(`   CTF: ${r.condition_id_ctf || 'undefined'}`);
    console.log(`   Market: ${r.condition_id_market || 'undefined'}`);
    console.log(`   Raw: ${JSON.stringify(r)}\n`);
  });
}

main().catch(console.error);
