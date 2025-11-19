import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Listing all databases:\n');

  const query = await clickhouse.query({
    query: `SHOW DATABASES`,
    format: 'JSONEachRow'
  });

  const dbs: any[] = await query.json();
  dbs.forEach(db => console.log(`  ${db.name}`));

  console.log('\n\nListing all tables with "bridge" in the name:\n');

  const tablesQuery = await clickhouse.query({
    query: `
      SELECT database, name
      FROM system.tables
      WHERE name LIKE '%bridge%'
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await tablesQuery.json();
  tables.forEach(t => console.log(`  ${t.database}.${t.name}`));

  console.log('\n\nListing all tables with "ctf" in the name:\n');

  const ctfQuery = await clickhouse.query({
    query: `
      SELECT database, name
      FROM system.tables
      WHERE name LIKE '%ctf%'
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });

  const ctfTables: any[] = await ctfQuery.json();
  ctfTables.forEach(t => console.log(`  ${t.database}.${t.name}`));
}

main().catch(console.error);
