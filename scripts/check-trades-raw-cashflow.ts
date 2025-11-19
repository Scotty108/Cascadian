import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  
  const res = await clickhouse.query({
    query: `
      SELECT entry_price, shares, cashflow_usdc
      FROM trades_raw
      WHERE lower(wallet) = lower('${wallet}')
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  
  console.log("trades_raw sample data:");
  console.table(rows);
  
  console.log("\nExpected: cashflow_usdc = entry_price × shares");
  console.log("Example: 0.016 × 891 = 14.256");
}

main().catch(console.error);
