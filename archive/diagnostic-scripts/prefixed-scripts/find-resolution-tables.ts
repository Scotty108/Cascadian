import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Searching for resolution tables...\n');

  const tables = await clickhouse.query({
    query: `SELECT name FROM system.tables WHERE database = 'default' AND (name LIKE '%resolut%' OR name LIKE '%payout%' OR name LIKE '%winning%')`,
    format: 'JSONEachRow'
  });

  const tableList = await tables.json();
  console.log('Found tables:');
  tableList.forEach((t: any) => console.log(' -', t.name));

  // Check if any have winning_index
  console.log('\nChecking for winning_index or payout fields...\n');

  for (const t of tableList) {
    const cols = await clickhouse.query({
      query: `SELECT name FROM system.columns WHERE database = 'default' AND table = '${t.name}' AND (name LIKE '%winning_index%' OR name LIKE '%payout%')`,
      format: 'JSONEachRow'
    });
    const colList = await cols.json();
    if (colList.length > 0) {
      console.log(t.name + ':');
      colList.forEach((c: any) => console.log('  -', c.name));
    }
  }
}

main().catch(console.error);
