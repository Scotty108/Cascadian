import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

async function investigate() {
  console.log('=== FINDING MARKET/EVENT TABLES ===\n');

  const tables = await clickhouse.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE (database = 'default' OR database = 'cascadian_clean')
        AND (name LIKE '%market%'
             OR name LIKE '%event%'
             OR name LIKE '%meta%'
             OR name LIKE '%title%'
             OR name LIKE '%description%'
             OR name LIKE '%condition%'
             OR name LIKE '%gamma%'
             OR name LIKE '%clob%')
      ORDER BY total_rows DESC NULLS LAST
    `,
    format: 'JSONEachRow'
  });

  const data = await tables.json<any>();
  console.log('Found', data.length, 'relevant tables:\n');
  data.forEach((t: any) => {
    console.log(`${t.database}.${t.name}`);
    console.log(`  Engine: ${t.engine}`);
    console.log(`  Rows: ${t.total_rows?.toLocaleString() || 0}`);
    console.log(`  Size: ${(t.total_bytes / 1024 / 1024).toFixed(2)} MB\n`);
  });

  // Now sample each table to see structure
  console.log('\n=== SAMPLING GAMMA/MARKET TABLES ===\n');

  const importantTables = data.filter((t: any) =>
    t.name.includes('gamma') ||
    t.name.includes('market') ||
    t.name.includes('clob')
  );

  for (const table of importantTables) {
    console.log(`\n--- ${table.database}.${table.name} ---`);
    try {
      const sample = await clickhouse.query({
        query: `SELECT * FROM ${table.database}.${table.name} LIMIT 3`,
        format: 'JSONEachRow'
      });
      const rows = await sample.json<any>();
      if (rows.length > 0) {
        console.log('Columns:', Object.keys(rows[0]).join(', '));
        console.log('Sample:', JSON.stringify(rows[0], null, 2));
      }
    } catch (e: any) {
      console.log('Error:', e.message);
    }
  }
}

investigate().catch(console.error);
