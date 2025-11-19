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

async function checkSchemas() {
  const tables = [
    'default.erc1155_transfers',
    'default.erc20_transfers_staging',
    'default.vw_trades_canonical',
    'default.fact_trades_clean',
    'cascadian_clean.fact_trades_clean',
  ];

  for (const table of tables) {
    console.log(`\n=== ${table} ===`);
    try {
      const result = await client.query({
        query: `DESCRIBE ${table}`,
        format: 'JSONEachRow',
      });
      const schema = await result.json<any[]>();
      console.log('Columns:', schema.map(s => s.name).join(', '));
      
      // Try a simple count
      const countResult = await client.query({
        query: `SELECT count(*) as cnt FROM ${table}`,
        format: 'JSONEachRow',
      });
      const count = await countResult.json<any[]>();
      console.log('Row count:', count[0].cnt);
    } catch (e: any) {
      console.log('ERROR:', e.message);
    }
  }
  
  await client.close();
}

checkSchemas().catch(console.error);
