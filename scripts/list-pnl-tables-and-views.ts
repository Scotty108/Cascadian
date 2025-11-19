import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  // List all tables
  console.log("=== TABLES containing 'pnl' ===");
  const tables = await clickhouse.query({
    query: "SHOW TABLES LIKE '%pnl%'",
    format: 'JSONEachRow'
  });
  const tableRows = await tables.json();
  for (const row of tableRows) {
    console.log(`- ${row.name}`);
  }
  
  // List all views
  console.log("\n=== VIEWS containing 'pnl', 'position', 'cashflow', or 'trade' ===");
  const views = await clickhouse.query({
    query: `SELECT name, engine FROM system.tables 
            WHERE database = 'default' 
            AND (name LIKE '%pnl%' OR name LIKE '%position%' OR name LIKE '%cashflow%' OR name LIKE '%trade%')
            AND engine LIKE '%View'
            ORDER BY name`,
    format: 'JSONEachRow'
  });
  const viewRows = await views.json();
  for (const row of viewRows) {
    console.log(`- ${row.name} [${row.engine}]`);
  }
}

main().catch(console.error);
