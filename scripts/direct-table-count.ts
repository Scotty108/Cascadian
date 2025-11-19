#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function check() {
  try {
    // Direct count
    const result1 = await clickhouse.query({
      query: `SELECT count() FROM erc1155_transfers`,
      format: 'JSONEachRow',
    });
    const data1 = await result1.json<any>();
    console.log(`\nerc1155_transfers count: ${data1[0]['count()']}`);
    
    // With details
    const result2 = await clickhouse.query({
      query: `
        SELECT 
          count() as cnt,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    const data2 = await result2.json<any>();
    console.log(`\nDetailed:`);
    console.log(`  Count: ${data2[0].cnt}`);
    console.log(`  Min block: ${data2[0].min_block}`);
    console.log(`  Max block: ${data2[0].max_block}`);
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

check();
