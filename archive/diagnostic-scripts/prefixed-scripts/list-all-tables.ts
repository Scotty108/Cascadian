import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const result = await clickhouse.query({
    query: `SHOW TABLES`,
    format: 'JSONEachRow'
  });

  const tables: any[] = await result.json();
  tables.forEach(t => console.log(t.name));
}

main().catch(console.error);
