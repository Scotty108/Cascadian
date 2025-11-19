import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('Discovering all ID columns...\n');

  const tablesQuery = await clickhouse.query({
    query: `SELECT name, total_rows FROM system.tables WHERE database = currentDatabase() AND engine NOT LIKE '%View%' AND name NOT LIKE '.inner%' ORDER BY total_rows DESC`,
    format: 'JSONEachRow'
  });

  const tables = await tablesQuery.json();
  console.log(`Found ${tables.length} tables\n`);

  const results = [];
  const idPatterns = ['condition', 'cid', 'token', 'tid', 'asset', 'aid', 'market', 'mid', 'wallet', 'address', 'proxy', 'trader', 'user', 'owner', 'outcome', 'winning'];

  for (const table of tables) {
    const columnsQuery = await clickhouse.query({
      query: `SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = '${table.name}'`,
      format: 'JSONEachRow'
    });

    const columns = await columnsQuery.json();
    const idColumns = columns.filter(col => idPatterns.some(pattern => col.name.toLowerCase().includes(pattern)));

    if (idColumns.length > 0) {
      console.log(`${table.name}:`);
      idColumns.forEach(col => {
        console.log(`  ${col.name} : ${col.type}`);
        results.push({ table: table.name, column: col.name, type: col.type, total_rows: table.total_rows });
      });
      console.log('');
    }
  }

  writeFileSync('./ID_COLUMNS_INVENTORY.json', JSON.stringify({ discovered_at: new Date().toISOString(), columns: results }, null, 2));
  console.log(`\nDONE: ${results.length} ID columns found, saved to ID_COLUMNS_INVENTORY.json`);
}

main().catch(console.error);
