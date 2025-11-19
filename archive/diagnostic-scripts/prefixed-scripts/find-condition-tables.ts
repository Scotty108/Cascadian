import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: `SHOW TABLES LIKE '%condition%' OR LIKE '%resolved%'`,
    format: 'JSONEachRow'
  });

  const tables = await result.json();
  console.log('Tables matching "condition" or "resolved":');
  console.log(JSON.stringify(tables, null, 2));
}

main().catch(console.error);
