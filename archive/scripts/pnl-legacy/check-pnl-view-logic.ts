import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Check the current VIEW definition
  const viewDef = await clickhouse.query({
    query: 'SHOW CREATE VIEW realized_pnl_by_market_final',
    format: 'JSONEachRow'
  });
  const def = await viewDef.json();
  
  console.log("Current VIEW definition:");
  console.log("═".repeat(80));
  console.log(def[0].statement);
  console.log("═".repeat(80));
  console.log();

  // Sample the data
  const sample = await clickhouse.query({
    query: `SELECT * FROM realized_pnl_by_market_final WHERE wallet = lower('${wallet}') LIMIT 5`,
    format: 'JSONEachRow'
  });
  const rows = await sample.json();
  
  console.log("Sample rows:");
  console.table(rows);
}

main().catch(console.error);
