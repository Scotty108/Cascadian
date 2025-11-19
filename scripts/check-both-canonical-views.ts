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

async function checkView(viewName: string) {
  console.log('═'.repeat(80));
  console.log(`Checking: default.${viewName}`);
  console.log('═'.repeat(80));
  console.log();

  // Get schema
  const schema = await client.query({
    query: `DESCRIBE TABLE default.${viewName}`,
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
    c.name.toLowerCase().includes('resolution') ||
    c.name.toLowerCase().includes('cost')
  );

  if (pnlCols.length > 0) {
    console.log('🎯 PnL-related columns found:');
    pnlCols.forEach(c => console.log(`  ✅ ${c.name}: ${c.type}`));
    console.log();
  } else {
    console.log('❌ No PnL-related columns found\n');
  }

  // Get sample
  console.log('Sample data:');
  const sample = await client.query({
    query: `SELECT * FROM default.${viewName} LIMIT 2`,
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log(JSON.stringify(rows, null, 2).substring(0, 1000));
  console.log();

  // Get row count
  const count = await client.query({
    query: `SELECT count() as cnt FROM default.${viewName}`,
    format: 'JSONEachRow',
  });

  const cnt = (await count.json<Array<{ cnt: number }>>())[0];
  console.log(`Total rows: ${cnt.cnt.toLocaleString()}\n`);
}

async function main() {
  await checkView('vw_trades_canonical');
  await checkView('vw_trades_canonical_v2');
  await client.close();
}

main().catch(console.error);
