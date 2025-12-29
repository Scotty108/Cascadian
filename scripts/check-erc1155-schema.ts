import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function checkSchema() {
  // Check if table exists
  const tablesResult = await clickhouse.query({
    query: `SELECT name FROM system.tables WHERE database = currentDatabase() AND name LIKE '%erc1155%'`,
    format: 'JSONEachRow'
  });
  const tables = await tablesResult.json();
  console.log('ERC1155 Tables:', tables);
  
  if (tables.length === 0) {
    console.log('No ERC1155 tables found');
    return;
  }
  
  for (const table of tables as any[]) {
    console.log(`\n=== Schema for ${table.name} ===`);
    const result = await clickhouse.query({
      query: `DESCRIBE ${table.name}`,
      format: 'JSONEachRow'
    });
    const schema = await result.json();
    console.log(JSON.stringify(schema, null, 2));
    
    // Sample row
    console.log(`\n=== Sample row from ${table.name} ===`);
    const sampleResult = await clickhouse.query({
      query: `SELECT * FROM ${table.name} LIMIT 1`,
      format: 'JSONEachRow'
    });
    const sample = await sampleResult.json();
    console.log(JSON.stringify(sample, null, 2));
  }
}

checkSchema().catch(console.error);
