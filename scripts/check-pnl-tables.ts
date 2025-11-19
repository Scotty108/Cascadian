import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function checkTables() {
  const result = await clickhouse.query({
    query: `
      SELECT name, engine, total_rows, formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%pnl%' OR name LIKE '%wallet%' OR name LIKE '%position%')
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });

  const tables = await result.json();
  console.log('P&L / Wallet / Position Tables:');
  console.log(JSON.stringify(tables, null, 2));
}

checkTables().catch(console.error);
