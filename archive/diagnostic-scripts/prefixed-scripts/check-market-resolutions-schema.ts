import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Checking market_resolutions_by_market schema:\n');

  const schema = await clickhouse.query({
    query: `DESCRIBE default.market_resolutions_by_market`,
    format: 'JSONEachRow'
  });

  const cols: any[] = await schema.json();
  cols.forEach(c => console.log(`  ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n\nSample rows:\n');

  const sample = await clickhouse.query({
    query: `SELECT * FROM default.market_resolutions_by_market LIMIT 3`,
    format: 'JSONEachRow'
  });

  const rows: any[] = await sample.json();
  rows.forEach(r => console.log(JSON.stringify(r)));
}

main().catch(console.error);
