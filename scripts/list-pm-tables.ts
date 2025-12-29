import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  // List all pm_* tables
  const tablesResult = await clickhouse.query({
    query: "SHOW TABLES LIKE 'pm_%'",
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json() as any[];
  
  console.log('=== ALL pm_* TABLES ===\n');
  
  for (const row of tables) {
    const tableName = row.name;
    
    // Get row count
    const countResult = await clickhouse.query({
      query: 'SELECT count() as cnt FROM ' + tableName,
      format: 'JSONEachRow'
    });
    const countData = await countResult.json() as any[];
    const count = countData[0]?.cnt || 0;
    
    console.log(tableName + ': ' + count + ' rows');
  }
  
  await clickhouse.close();
}

main().catch(console.error);
