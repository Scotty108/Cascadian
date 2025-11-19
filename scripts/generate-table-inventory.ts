import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function generateTableInventory() {
  console.log('\n📊 GENERATING COMPLETE TABLE INVENTORY\n');
  console.log('='.repeat(80));

  // Get all tables from both databases
  const tablesQuery = `
    SELECT
      database,
      name as table_name,
      engine,
      total_rows,
      formatReadableSize(total_bytes) as size,
      metadata_modification_time as last_modified
    FROM system.tables
    WHERE database IN ('default', 'cascadian_clean')
      AND engine NOT LIKE '%View%'
      AND engine != 'Dictionary'
    ORDER BY database, total_rows DESC
  `;

  const tablesResult = await clickhouse.query({
    query: tablesQuery,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json();

  console.log(`Found ${tables.length} tables\n`);

  // Group by database
  const byDatabase: any = {};
  for (const table of tables) {
    if (!byDatabase[table.database]) {
      byDatabase[table.database] = [];
    }
    byDatabase[table.database].push(table);
  }

  // For each table, get schema and sample
  const inventory: any = {};

  for (const db of Object.keys(byDatabase)) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`DATABASE: ${db}`);
    console.log('='.repeat(80));

    inventory[db] = [];

    for (const table of byDatabase[db]) {
      const fullName = `${db}.${table.table_name}`;
      console.log(`\nAnalyzing ${fullName}...`);

      try {
        // Get schema
        const schemaQuery = `DESCRIBE TABLE ${fullName}`;
        const schemaResult = await clickhouse.query({
          query: schemaQuery,
          format: 'JSONEachRow'
        });
        const schema = await schemaResult.json();

        // Get sample
        const sampleQuery = `SELECT * FROM ${fullName} LIMIT 3`;
        const sampleResult = await clickhouse.query({
          query: sampleQuery,
          format: 'JSONEachRow'
        });
        const samples = await sampleResult.json();

        // Identify key columns (likely used for joins)
        const keyColumns = schema.filter((col: any) =>
          col.name.includes('id') ||
          col.name.includes('address') ||
          col.name.includes('hash') ||
          col.name.includes('key')
        );

        inventory[db].push({
          table: table.table_name,
          fullName,
          engine: table.engine,
          rows: parseInt(table.total_rows || 0),
          size: table.size,
          lastModified: table.last_modified,
          columns: schema.length,
          keyColumns: keyColumns.map((c: any) => c.name),
          schema: schema.map((c: any) => ({ name: c.name, type: c.type })),
          sampleData: samples.length > 0 ? samples[0] : null
        });

        console.log(`  ✅ ${schema.length} columns, ${keyColumns.length} key columns`);
      } catch (e: any) {
        console.log(`  ❌ Error: ${e.message}`);
        inventory[db].push({
          table: table.table_name,
          fullName,
          error: e.message
        });
      }
    }
  }

  // Save inventory to JSON
  const fs = require('fs');
  const outputPath = resolve(process.cwd(), 'docs/systems/database/table-inventory.json');
  fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2));
  console.log(`\n✅ Inventory saved to: ${outputPath}`);

  // Generate summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY STATISTICS\n');

  const totalTables = tables.length;
  const totalRows = tables.reduce((sum: number, t: any) => sum + parseInt(t.total_rows || 0), 0);

  const byEngineType: any = {};
  for (const table of tables) {
    const engineType = table.engine.split('(')[0]; // Extract base engine name
    byEngineType[engineType] = (byEngineType[engineType] || 0) + 1;
  }

  console.log(`Total tables: ${totalTables}`);
  console.log(`Total rows: ${totalRows.toLocaleString()}`);
  console.log('\nBy engine type:');
  Object.entries(byEngineType)
    .sort(([, a]: any, [, b]: any) => b - a)
    .forEach(([engine, count]) => {
      console.log(`  ${engine}: ${count}`);
    });

  console.log('\nTop 10 largest tables:');
  tables
    .sort((a: any, b: any) => parseInt(b.total_rows || 0) - parseInt(a.total_rows || 0))
    .slice(0, 10)
    .forEach((t: any) => {
      console.log(`  ${t.database}.${t.table_name}: ${parseInt(t.total_rows || 0).toLocaleString()} rows`);
    });

  console.log('\n' + '='.repeat(80));
}

generateTableInventory().catch(console.error);
