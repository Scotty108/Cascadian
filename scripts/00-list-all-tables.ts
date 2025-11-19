import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function listTables() {
  console.log('=== Listing All Tables in polymarket Database ===\n');

  const query = `
    SELECT name, engine, total_rows
    FROM system.tables
    WHERE database = 'polymarket'
      AND name NOT LIKE '.%'
    ORDER BY name
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const tables = await result.json<{ name: string; engine: string; total_rows: string }[]>();

  console.log(`Found ${tables.length} tables:\n`);

  console.log('=== Tables containing "trade" ===\n');
  const tradeTables = tables.filter(t => t.name.toLowerCase().includes('trade'));
  tradeTables.forEach((t) => console.log(`  - ${t.name} (${t.engine}, ${t.total_rows} rows)`));

  console.log('\n=== Tables containing "canonical" ===\n');
  const canonicalTables = tables.filter(t => t.name.toLowerCase().includes('canonical'));
  canonicalTables.forEach((t) => console.log(`  - ${t.name} (${t.engine}, ${t.total_rows} rows)`));

  if (canonicalTables.length === 0) {
    console.log('  (none found)');
  }

  console.log('\n=== Tables containing "v3" ===\n');
  const v3Tables = tables.filter(t => t.name.toLowerCase().includes('v3'));
  v3Tables.forEach((t) => console.log(`  - ${t.name} (${t.engine}, ${t.total_rows} rows)`));

  if (v3Tables.length === 0) {
    console.log('  (none found)');
  }

  process.exit(0);
}

listTables().catch(console.error);
