import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const name = process.argv[2] || 'realized_pnl_by_market_final';
  
  // Try as table
  try {
    const res = await clickhouse.query({
      query: `SHOW CREATE TABLE ${name}`,
      format: 'JSONEachRow'
    });
    const rows = await res.json();
    console.log(`TABLE: ${name}`);
    console.log("=".repeat(80));
    console.log(rows[0].statement);
    return;
  } catch (e) {
    // Not a table, try as view
  }
  
  // Try as view
  try {
    const res = await clickhouse.query({
      query: `SHOW CREATE VIEW ${name}`,
      format: 'JSONEachRow'
    });
    const rows = await res.json();
    console.log(`VIEW: ${name}`);
    console.log("=".repeat(80));
    console.log(rows[0].statement);
  } catch (e: any) {
    console.error(`Not found: ${e.message}`);
  }
}

main().catch(console.error);
