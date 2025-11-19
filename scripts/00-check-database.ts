import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkDatabase() {
  console.log('=== Database Connection Check ===\n');

  // Check current database
  const currentDbQuery = `SELECT currentDatabase() as db`;
  const currentDb = await clickhouse.query({ query: currentDbQuery, format: 'JSONEachRow' });
  const currentDbData = await currentDb.json<{ db: string }[]>();
  console.log('Current database:', currentDbData[0].db);

  // List all databases
  const dbsQuery = `SHOW DATABASES`;
  const dbs = await clickhouse.query({ query: dbsQuery, format: 'JSONEachRow' });
  const dbsList = await dbs.json<{ name: string }[]>();
  console.log('\nAvailable databases:');
  dbsList.forEach((d) => console.log(`  - ${d.name}`));

  // Check environment variable
  console.log('\nClickHouse config from .env.local:');
  console.log('  CLICKHOUSE_DATABASE:', process.env.CLICKHOUSE_DATABASE || '(not set, using "default")');
  console.log('  CLICKHOUSE_HOST:', process.env.CLICKHOUSE_HOST ? '(set)' : '(not set)');
  console.log('  CLICKHOUSE_USER:', process.env.CLICKHOUSE_USER || 'default');

  // Try to list tables in the current database
  console.log('\nTables in current database:');
  const tablesQuery = `SELECT name, engine, total_rows FROM system.tables WHERE database = currentDatabase() ORDER BY name`;
  const tables = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tablesList = await tables.json<{ name: string; engine: string; total_rows: string }[]>();

  if (tablesList.length === 0) {
    console.log('  (no tables found)');
  } else {
    tablesList.slice(0, 10).forEach((t) => console.log(`  - ${t.name} (${t.total_rows} rows)`));
    if (tablesList.length > 10) {
      console.log(`  ... and ${tablesList.length - 10} more`);
    }
  }

  process.exit(0);
}

checkDatabase().catch(console.error);
