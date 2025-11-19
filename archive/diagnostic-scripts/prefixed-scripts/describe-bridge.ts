import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const query = await clickhouse.query({
    query: 'DESCRIBE TABLE ctf_to_market_bridge_mat',
    format: 'JSONEachRow'
  });

  const schema: any[] = await query.json();
  console.log('ctf_to_market_bridge_mat schema:\n');
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  const sampleQuery = await clickhouse.query({
    query: 'SELECT * FROM ctf_to_market_bridge_mat LIMIT 5',
    format: 'JSONEachRow'
  });

  const sample: any[] = await sampleQuery.json();
  console.log(`\nSample rows (${sample.length}):\n`);
  console.log(JSON.stringify(sample, null, 2));

  await clickhouse.close();
}

main().catch(console.error);
