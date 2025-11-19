#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function listAllTables() {
  console.log('DATABASE INVENTORY\n');
  console.log('═'.repeat(100));

  const query = await client.query({
    query: `
      SELECT
        database,
        name AS table_name,
        engine,
        formatReadableSize(total_bytes) AS size,
        total_rows,
        CASE
          WHEN engine = 'View' THEN 'VIEW'
          ELSE 'TABLE'
        END AS object_type,
        metadata_modification_time AS last_modified
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND name NOT LIKE '.%'
      ORDER BY database, object_type, total_bytes DESC
    `,
    format: 'JSONEachRow',
  });

  const tables = await query.json<any[]>();

  // Group by database
  const byDatabase: Record<string, any[]> = {};
  for (const t of tables) {
    if (!byDatabase[t.database]) byDatabase[t.database] = [];
    byDatabase[t.database].push(t);
  }

  for (const [db, items] of Object.entries(byDatabase)) {
    console.log(`\n${db.toUpperCase()} DATABASE`);
    console.log('─'.repeat(100));

    const tableItems = items.filter(i => i.object_type === 'TABLE');
    const viewItems = items.filter(i => i.object_type === 'VIEW');

    console.log(`\nTABLES (${tableItems.length}):`);
    console.log('─'.repeat(100));
    console.log(
      'TABLE NAME'.padEnd(50) +
      'ENGINE'.padEnd(20) +
      'SIZE'.padEnd(15) +
      'ROWS'
    );
    console.log('─'.repeat(100));

    for (const t of tableItems) {
      console.log(
        t.table_name.padEnd(50) +
        t.engine.padEnd(20) +
        t.size.padEnd(15) +
        t.total_rows.toLocaleString()
      );
    }

    console.log(`\nVIEWS (${viewItems.length}):`);
    console.log('─'.repeat(100));
    for (const v of viewItems) {
      console.log(`  ${v.table_name}`);
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log(`Total tables: ${tables.filter(t => t.object_type === 'TABLE').length}`);
  console.log(`Total views: ${tables.filter(t => t.object_type === 'VIEW').length}`);

  await client.close();
}

listAllTables().catch(console.error);
