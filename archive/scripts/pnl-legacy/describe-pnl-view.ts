import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const res = await clickhouse.query({
    query: `DESCRIBE TABLE realized_pnl_by_market_final`,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  
  console.log("realized_pnl_by_market_final columns:");
  console.table(rows);
}

main().catch(console.error);
