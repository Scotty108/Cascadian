import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  
  const res = await clickhouse.query({
    query: `
      SELECT wallet, condition_id_norm, realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const rows = await res.json();
  
  console.log("realized_pnl_by_market_final sample:");
  console.table(rows);
  
  const total = await clickhouse.query({
    query: `
      SELECT sum(realized_pnl_usd) as total
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const totalRows = await total.json();
  console.log("\nTotal P&L:", totalRows[0].total);
}

main().catch(console.error);
