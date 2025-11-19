import { clickhouseClient } from './lib/clickhouse/client';

async function listAllTables() {
  console.log('=== LISTING ALL TABLES ===\n');
  
  const result = await clickhouseClient.query({
    query: `
      SELECT 
        database,
        name as table_name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size,
        total_bytes,
        create_table_query
      FROM system.tables
      WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });
  
  const tables = await result.json();
  
  console.log('Total Tables:', tables.length);
  
  // Group by database
  const byDatabase = {};
  tables.forEach((table) => {
    if (!byDatabase[table.database]) {
      byDatabase[table.database] = [];
    }
    byDatabase[table.database].push(table);
  });
  
  // Print summary
  console.log('\nTables by Database:');
  Object.entries(byDatabase).forEach(([db, tbls]) => {
    console.log(`\n${db} (${tbls.length} tables):`);
    tbls.forEach((t) => {
      console.log(`  - ${t.table_name} (${t.engine}) - ${t.total_rows} rows - ${t.size}`);
    });
  });
  
  return tables;
}

listAllTables().catch(console.error);
