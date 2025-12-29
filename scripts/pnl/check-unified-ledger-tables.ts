#!/usr/bin/env npx tsx
/**
 * Check unified ledger table types to find best physical table
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('Checking unified ledger tables...\n');

  const query = `
    SELECT
      database,
      name,
      engine,
      is_temporary,
      total_rows,
      formatReadableSize(total_bytes) as size,
      create_table_query
    FROM system.tables
    WHERE name LIKE '%unified_ledger%'
    ORDER BY name
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  });

  const tables = await result.json<any>();

  console.log(`Found ${tables.length} unified ledger table(s):\n`);

  for (const table of tables) {
    console.log(`Table: ${table.name}`);
    console.log(`  Database: ${table.database}`);
    console.log(`  Engine: ${table.engine}`);
    console.log(`  Rows: ${Number(table.total_rows).toLocaleString()}`);
    console.log(`  Size: ${table.size}`);
    console.log(`  Is temporary: ${table.is_temporary}`);

    if (table.engine.includes('View')) {
      console.log(`  ⚠️  This is a VIEW, not a physical table`);
    } else if (table.engine.includes('MergeTree')) {
      console.log(`  ✅ This is a physical MergeTree table`);
    }
    console.log('');
  }

  // Check for materialized tables specifically
  const matQuery = `
    SELECT
      name,
      engine,
      total_rows,
      formatReadableSize(total_bytes) as size
    FROM system.tables
    WHERE (name LIKE '%unified_ledger%' OR name LIKE '%pm_unified%')
      AND engine LIKE '%MergeTree%'
    ORDER BY total_rows DESC
  `;

  const matResult = await clickhouse.query({
    query: matQuery,
    format: 'JSONEachRow',
  });

  const matTables = await matResult.json<any>();

  console.log(`\nPhysical MergeTree tables:\n`);
  for (const table of matTables) {
    console.log(`${table.name}: ${table.engine}, ${Number(table.total_rows).toLocaleString()} rows, ${table.size}`);
  }

  if (matTables.length > 0) {
    console.log(`\n✅ RECOMMENDATION: Use '${matTables[0].name}' for fastest queries`);
  } else {
    console.log(`\n⚠️  No physical MergeTree table found`);
  }

  process.exit(0);
}

main().catch(console.error);
