import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  
  try {
    const res = await clickhouse.query({
      query: `
        SELECT outcome_idx, net_shares
        FROM outcome_positions_v2
        WHERE wallet = lower('${wallet}')
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const rows = await res.json();
    
    console.log("outcome_positions_v2 sample data:");
    console.table(rows);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main().catch(console.error);
