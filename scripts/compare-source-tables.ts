import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("=== CLOB_FILLS (source from API) ===");
  const clob = await clickhouse.query({
    query: "SELECT size, price FROM clob_fills LIMIT 5",
    format: 'JSONEachRow'
  });
  const clobRows = await clob.json();
  console.table(clobRows);
  
  console.log("\n=== TRADES_RAW (processed trades) ===");
  const trades = await clickhouse.query({
    query: "SELECT shares, entry_price FROM trades_raw LIMIT 5",
    format: 'JSONEachRow'
  });
  const tradeRows = await trades.json();
  console.table(tradeRows);
  
  console.log("\nCLOB_FILLS uses micro-shares (e.g., 891000000)");
  console.log("TRADES_RAW already converted to decimal shares (e.g., 0.039...)");
}

main().catch(console.error);
