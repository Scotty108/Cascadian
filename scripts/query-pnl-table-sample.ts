import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  
  // Query realized_pnl_by_market_final table
  const res = await clickhouse.query({
    query: `
      SELECT wallet, condition_id_norm, realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  
  console.log("Sample from realized_pnl_by_market_final:");
  console.table(rows);
  
  // Get totals
  const total = await clickhouse.query({
    query: `
      SELECT 
        count() as markets,
        sum(realized_pnl_usd) as total_pnl
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const totalRows = await total.json();
  console.log("\nTotals:");
  console.table(totalRows);
}

main().catch(console.error);
