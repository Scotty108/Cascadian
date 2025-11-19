import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const tables = ['api_markets_staging', 'gamma_markets', 'condition_market_map', 'market_key_map'];

  for (const table of tables) {
    try {
      const result = await clickhouse.query({
        query: `DESCRIBE default.${table}`,
        format: 'JSONEachRow'
      });
      const schema = await result.json<Array<{name: string, type: string}>>();
      console.log(`\n=== ${table} ===`);
      schema.forEach(col => console.log(`  ${col.name}: ${col.type}`));
    } catch (e: any) {
      console.log(`\n=== ${table} === ERROR: ${e.message}`);
    }
  }
}

main();
