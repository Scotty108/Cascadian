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

async function checkTable(tableName: string) {
  console.log('═'.repeat(80));
  console.log(`Checking: ${tableName}`);
  console.log('═'.repeat(80));

  // Get schema
  const schema = await client.query({
    query: `DESCRIBE TABLE default.${tableName}`,
    format: 'JSONEachRow',
  });

  const cols = await schema.json<Array<{name: string; type: string}>>();
  console.log('\nColumns:', cols.map(c => c.name).join(', '));
  console.log();

  // Get sample
  const sample = await client.query({
    query: `SELECT * FROM default.${tableName} LIMIT 2`,
    format: 'JSONEachRow',
  });

  const rows = await sample.json();
  console.log('Sample:');
  console.log(JSON.stringify(rows, null, 2).substring(0, 1000));
  console.log();

  // Check for condition_id
  const hasCondition = cols.some(c => c.name.toLowerCase().includes('condition') || c.name.toLowerCase().includes('cid'));
  
  if (hasCondition) {
    const condCol = cols.find(c => c.name.toLowerCase().includes('condition') || c.name.toLowerCase().includes('cid'))!.name;
    
    // Count unique markets
    const count = await client.query({
      query: `SELECT count(DISTINCT ${condCol}) AS cnt FROM default.${tableName}`,
      format: 'JSONEachRow',
    });
    
    const c = (await count.json<Array<any>>())[0];
    console.log(`Unique markets: ${c.cnt.toLocaleString()}`);
    console.log();
  }
}

async function main() {
  console.log('CHECKING REALIZED PNL TABLES (must have resolution data!)\n');

  await checkTable('realized_pnl_by_market_final');
  await checkTable('wallet_realized_pnl_final');
  await checkTable('wallet_resolution_outcomes');
  await checkTable('ctf_payout_data');

  await client.close();
}

main().catch(console.error);
