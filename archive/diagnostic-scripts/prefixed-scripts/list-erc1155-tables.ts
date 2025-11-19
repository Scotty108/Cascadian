import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const query = await clickhouse.query({
    query: `SHOW TABLES LIKE '%erc1155%'`,
    format: 'JSONEachRow'
  });

  const tables: any[] = await query.json();
  console.log('ERC1155 tables:');
  tables.forEach(t => console.log(`  ${t.name}`));
}

main().catch(console.error);
