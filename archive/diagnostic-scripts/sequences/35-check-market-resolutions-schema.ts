import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const query = await clickhouse.query({
    query: 'DESCRIBE market_resolutions_final',
    format: 'JSONEachRow'
  });
  const schema: any[] = await query.json();
  console.table(schema.map(s => ({ name: s.name, type: s.type })));

  const query2 = await clickhouse.query({
    query: 'SELECT * FROM market_resolutions_final LIMIT 3',
    format: 'JSONEachRow'
  });
  const sample = await query2.json();
  console.log('\nSample:');
  console.log(JSON.stringify(sample, null, 2));
}

main().catch(console.error);
