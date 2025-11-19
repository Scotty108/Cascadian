import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const view = process.argv[2] || 'wallet_pnl_summary_final';
  
  try {
    const res = await clickhouse.query({
      query: `SHOW CREATE VIEW ${view}`,
      format: 'JSONEachRow'
    });
    const rows = await res.json();
    console.log(`View: ${view}`);
    console.log("="  .repeat(80));
    console.log(rows[0].statement);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }
}

main().catch(console.error);
