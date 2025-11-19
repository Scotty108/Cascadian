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
  console.log('CHECKING vw_trades_canonical SCHEMA');
  console.log('═'.repeat(80));
  console.log();

  // Get schema
  const schema = await client.query({
    query: `DESCRIBE TABLE default.vw_trades_canonical`,
    format: 'JSONEachRow',
  });

  const columns = await schema.json<Array<{name: string; type: string}>>();

  console.log('Columns in vw_trades_canonical:');
  console.log('─'.repeat(80));
  columns.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log();

  // Check for wallet-related columns
  const walletCols = columns.filter(c =>
    c.name.toLowerCase().includes('wallet') ||
    c.name.toLowerCase().includes('address') ||
    c.name.toLowerCase().includes('user')
  );

  if (walletCols.length > 0) {
    console.log('Wallet-related columns found:');
    walletCols.forEach(col => {
      console.log(`  ✅ ${col.name} (${col.type})`);
    });
  } else {
    console.log('⚠️  No wallet-related columns found!');
    console.log('   Need to check source tables or view definition');
  }
  console.log();

  // Get a sample row to see actual data
  console.log('Sample row:');
  console.log('─'.repeat(80));
  const sample = await client.query({
    query: `SELECT * FROM default.vw_trades_canonical LIMIT 1`,
    format: 'JSONEachRow',
  });

  const sampleRow = await sample.json<Array<any>>();
  if (sampleRow.length > 0) {
    console.log(JSON.stringify(sampleRow[0], null, 2));
  }

  await client.close();
}

main().catch(console.error);
