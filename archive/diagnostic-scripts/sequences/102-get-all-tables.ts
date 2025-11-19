import { clickhouse } from './lib/clickhouse/client';
import * as fs from 'fs';

async function getAllTables() {
  console.log('Getting all tables...\n');
  
  const result = await clickhouse.query({
    query: `
      SELECT 
        database,
        name as table_name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size,
        total_bytes,
        primary_key
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean', 'sandbox', 'staging')
      ORDER BY database, total_bytes DESC
    `,
    format: 'JSONEachRow'
  });
  
  const tables = await result.json();
  console.log(`Found ${tables.length} tables\n`);
  
  fs.writeFileSync('tables-list.json', JSON.stringify(tables, null, 2));
  console.log('Saved to tables-list.json');
  
  return tables;
}

getAllTables().catch(console.error);
