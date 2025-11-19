#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function checkAllTables() {
  console.log('\n📊 COMPREHENSIVE TABLE STATE CHECK');
  console.log('='.repeat(80));

  // Check all relevant tables
  const tables = [
    'trades_raw',
    'trades_with_direction',
    'trade_direction_assignments',
    'vw_trades_canonical',
    'erc1155_transfers',
    'erc1155_condition_map',
    'pm_erc1155_flats'
  ];

  for (const table of tables) {
    try {
      const result = await client.query({
        query: `SELECT count(*) as total, count(DISTINCT tx_hash) as unique_txs FROM ${table}`,
        format: 'JSONEachRow',
      });
      const data: any = (await result.json())[0];
      console.log(`\n${table}:`);
      console.log(`  Total rows: ${parseInt(data.total).toLocaleString()}`);
      console.log(`  Unique txs: ${parseInt(data.unique_txs).toLocaleString()}`);
    } catch (e) {
      try {
        // Try with transaction_hash instead
        const result = await client.query({
          query: `SELECT count(*) as total, count(DISTINCT transaction_hash) as unique_txs FROM ${table}`,
          format: 'JSONEachRow',
        });
        const data: any = (await result.json())[0];
        console.log(`\n${table}:`);
        console.log(`  Total rows: ${parseInt(data.total).toLocaleString()}`);
        console.log(`  Unique txs: ${parseInt(data.unique_txs).toLocaleString()}`);
      } catch (e2) {
        console.log(`\n${table}: Error checking (${(e as any).message})`);
      }
    }
  }

  // Check for any new recovery tables
  console.log('\n\n🔍 Checking for recovery tables:');
  const recoveryCheck = await client.query({
    query: "SHOW TABLES LIKE '%recovery%'",
    format: 'JSONEachRow',
  });
  const recoveryTables = await recoveryCheck.json();

  if (recoveryTables.length > 0) {
    console.log('Found recovery tables:');
    for (const table of recoveryTables) {
      const count = await client.query({
        query: `SELECT count(*) as total FROM ${(table as any).name}`,
        format: 'JSONEachRow',
      });
      const data: any = (await count.json())[0];
      console.log(`  ${(table as any).name}: ${parseInt(data.total).toLocaleString()} rows`);
    }
  } else {
    console.log('  No recovery tables found');
  }

  // Check for staging/temp tables
  console.log('\n\n📋 Checking for staging/temp tables:');
  const stagingCheck = await client.query({
    query: "SHOW TABLES LIKE '%staging%'",
    format: 'JSONEachRow',
  });
  const stagingTables = await stagingCheck.json();

  if (stagingTables.length > 0) {
    for (const table of stagingTables) {
      const count = await client.query({
        query: `SELECT count(*) as total FROM ${(table as any).name}`,
        format: 'JSONEachRow',
      });
      const data: any = (await count.json())[0];
      console.log(`  ${(table as any).name}: ${parseInt(data.total).toLocaleString()} rows`);
    }
  } else {
    console.log('  No staging tables found');
  }

  await client.close();
}

checkAllTables().catch(console.error);
