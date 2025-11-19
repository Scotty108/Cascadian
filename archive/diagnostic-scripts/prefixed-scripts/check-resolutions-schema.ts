import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const query = await clickhouse.query({
    query: 'DESCRIBE default.market_resolutions_final',
    format: 'JSONEachRow'
  });

  const schema: any[] = await query.json();
  schema.forEach(col => console.log(col.name.padEnd(30), col.type));
}

main().catch(console.error);
