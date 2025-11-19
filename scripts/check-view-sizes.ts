import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const views = [
    'outcome_positions_v2',
    'trade_cashflows_v3',
    'realized_pnl_by_market_final'
  ];

  console.log("Checking view sizes...\n");

  for (const viewName of views) {
    try {
      const result = await clickhouse.query({
        query: `SELECT count(*) as cnt FROM ${viewName}`,
        format: 'JSONEachRow'
      });
      const data = (await result.json())[0];
      console.log(`${viewName}: ${Number(data.cnt).toLocaleString()} rows`);
    } catch (error: any) {
      console.log(`${viewName}: ERROR - ${error.message}`);
    }
  }
}

main().catch(console.error);
