import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000
});

async function main() {
  // Get all tables and views with PnL-relevant fields
  console.log('=== COMPREHENSIVE INVENTORY OF PNL-RELATED DATA ===\n');
  
  // List all tables
  const tablesRes = await clickhouse.query({
    query: "SHOW TABLES",
    format: 'JSONEachRow'
  });
  const tables = await tablesRes.json() as any[];
  
  console.log('--- ALL pm_* TABLES WITH ROW COUNTS ---');
  for (const t of tables) {
    if (t.name.startsWith('pm_') && !t.name.includes('backup')) {
      try {
        const countRes = await clickhouse.query({
          query: 'SELECT count() as cnt FROM ' + t.name,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 10 }
        });
        const countData = await countRes.json() as any[];
        console.log('  ' + t.name + ': ' + countData[0]?.cnt + ' rows');
      } catch (e) {
        console.log('  ' + t.name + ': (timeout)');
      }
    }
  }
  
  console.log('\n--- ALL vw_* VIEWS ---');
  for (const t of tables) {
    if (t.name.startsWith('vw_')) {
      console.log('  ' + t.name);
    }
  }
  
  // Check if there are any clob tables
  console.log('\n--- CLOB FILLS TABLES ---');
  for (const t of tables) {
    if (t.name.includes('clob') || t.name.includes('fill') || t.name.includes('trade')) {
      const countRes = await clickhouse.query({
        query: 'SELECT count() as cnt FROM ' + t.name,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 10 }
      });
      const countData = await countRes.json() as any[];
      console.log('  ' + t.name + ': ' + countData[0]?.cnt + ' rows');
    }
  }
  
  // Check ERC1155 transfer tables
  console.log('\n--- ERC1155 / TRANSFER TABLES ---');
  for (const t of tables) {
    if (t.name.includes('erc1155') || t.name.includes('transfer')) {
      try {
        const countRes = await clickhouse.query({
          query: 'SELECT count() as cnt FROM ' + t.name,
          format: 'JSONEachRow',
          clickhouse_settings: { max_execution_time: 10 }
        });
        const countData = await countRes.json() as any[];
        console.log('  ' + t.name + ': ' + countData[0]?.cnt + ' rows');
      } catch (e) {
        console.log('  ' + t.name + ': (timeout)');
      }
    }
  }
  
  await clickhouse.close();
}

main().catch(console.error);
