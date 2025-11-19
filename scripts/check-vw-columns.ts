import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function check() {
  const result = await clickhouse.query({
    query: `DESCRIBE default.vw_trades_canonical`,
    format: 'JSONEachRow'
  });
  
  const cols = await result.json() as any[];
  console.log('Columns in vw_trades_canonical:');
  cols.forEach((c: any) => console.log(`  ${c.name}: ${c.type}`));
}

check();
