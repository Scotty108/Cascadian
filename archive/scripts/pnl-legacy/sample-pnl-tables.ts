import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

async function main() {
  // Check if there are any other pnl or position tables
  console.log('=== ALL TABLES WITH PNL OR POSITION ===');
  const allTablesRes = await clickhouse.query({
    query: "SHOW TABLES",
    format: 'JSONEachRow'
  });
  const allTables = await allTablesRes.json() as any[];
  for (const t of allTables) {
    const name = t.name.toLowerCase();
    if (name.includes('pnl') || name.includes('position') || name.includes('balance') || name.includes('payout') || name.includes('cost')) {
      console.log('  ' + t.name);
    }
  }
  
  // Get pm_market_pnl schema  
  console.log('\n=== pm_market_pnl - SCHEMA ===');
  const schemaRes = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_market_pnl',
    format: 'JSONEachRow'
  });
  const schema = await schemaRes.json() as any[];
  for (const col of schema) {
    console.log('  ' + col.name + ': ' + col.type);
  }
  
  // Simple sample with timeout protection
  console.log('\n=== pm_market_pnl - Sample 3 rows (using LIMIT) ===');
  try {
    const sampleRes = await clickhouse.query({
      query: 'SELECT * FROM pm_market_pnl ORDER BY realized_pnl DESC LIMIT 3',
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60
      }
    });
    const sampleData = await sampleRes.json();
    console.log(JSON.stringify(sampleData, null, 2));
  } catch (e: any) {
    console.log('Query timed out or failed: ' + e.message);
  }
  
  // Check pm_market_pnl_with_resolution
  console.log('\n=== pm_market_pnl_with_resolution - Sample 3 rows ===');
  try {
    const sampleRes2 = await clickhouse.query({
      query: 'SELECT * FROM pm_market_pnl_with_resolution ORDER BY realized_pnl DESC LIMIT 3',
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60
      }
    });
    const sampleData2 = await sampleRes2.json();
    console.log(JSON.stringify(sampleData2, null, 2));
  } catch (e: any) {
    console.log('Query timed out or failed: ' + e.message);
  }
  
  await clickhouse.close();
}

main().catch(console.error);
