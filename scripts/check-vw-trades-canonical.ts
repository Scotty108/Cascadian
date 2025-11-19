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

async function main() {
  console.log('Checking vw_trades_canonical...\n');

  // Get the view definition
  const viewDef = await client.query({
    query: `
      SELECT create_table_query
      FROM system.tables
      WHERE database = 'cascadian_clean' AND name = 'vw_trades_canonical'
    `,
    format: 'JSONEachRow',
  });

  const def = await viewDef.json<Array<{ create_table_query: string }>>();

  if (def.length === 0) {
    console.log('❌ vw_trades_canonical does not exist in cascadian_clean');

    // Check if it exists elsewhere
    const elsewhere = await client.query({
      query: `
        SELECT database, name
        FROM system.tables
        WHERE name LIKE '%trades_canonical%'
      `,
      format: 'JSONEachRow',
    });

    const tables = await elsewhere.json<Array<{ database: string; name: string }>>();
    if (tables.length > 0) {
      console.log('\nFound similar tables:');
      tables.forEach(t => console.log(`  ${t.database}.${t.name}`));
    }

    await client.close();
    return;
  }

  console.log('View definition:');
  console.log('═'.repeat(80));
  console.log(def[0].create_table_query);
  console.log('═'.repeat(80));
  console.log();

  // Get schema
  const schema = await client.query({
    query: 'DESCRIBE TABLE cascadian_clean.vw_trades_canonical',
    format: 'JSONEachRow',
  });

  const cols = await schema.json<Array<{ name: string; type: string }>>();
  console.log('Columns:');
  cols.forEach(c => console.log(`  ${c.name.padEnd(30)} ${c.type}`));
  console.log();

  // Check for PnL-related columns
  const pnlCols = cols.filter(c =>
    c.name.toLowerCase().includes('pnl') ||
    c.name.toLowerCase().includes('payout') ||
    c.name.toLowerCase().includes('winning') ||
    c.name.toLowerCase().includes('resolved') ||
    c.name.toLowerCase().includes('cost')
  );

  if (pnlCols.length > 0) {
    console.log('PnL-related columns:');
    pnlCols.forEach(c => console.log(`  ✅ ${c.name}: ${c.type}`));
    console.log();
  }

  // Get sample
  console.log('Sample data (1 row):');
  const sample = await client.query({
    query: 'SELECT * FROM cascadian_clean.vw_trades_canonical LIMIT 1',
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log(JSON.stringify(rows[0], null, 2));
  console.log();

  // Get row count
  const count = await client.query({
    query: 'SELECT count() as cnt FROM cascadian_clean.vw_trades_canonical',
    format: 'JSONEachRow',
  });

  const cnt = (await count.json<Array<{ cnt: number }>>())[0];
  console.log(`Total rows: ${cnt.cnt.toLocaleString()}`);

  await client.close();
}

main().catch(console.error);
