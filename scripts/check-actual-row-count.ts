#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function check() {
  try {
    console.log('🔍 Actual Row Count Check\n');
    
    // Get exact count
    const countResult = await clickhouse.query({
      query: `SELECT count() as total FROM erc1155_transfers`,
      format: 'JSONEachRow',
    });
    
    const countData = await countResult.json<any>();
    console.log(`erc1155_transfers: ${countData[0].total} rows\n`);
    
    // Get detailed breakdown
    const detailResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp > toDateTime(0)) as with_ts,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    
    const detail = await detailResult.json<any>();
    if (detail && detail[0]) {
      const d = detail[0];
      const pct = (parseInt(d.with_ts) / parseInt(d.total) * 100).toFixed(2);
      
      console.log('Detailed Breakdown:');
      console.log(`  Total: ${d.total}`);
      console.log(`  With timestamps: ${d.with_ts}`);
      console.log(`  Epoch zero: ${d.epoch_zero}`);
      console.log(`  Coverage: ${pct}%`);
      console.log(`  Block range: ${d.min_block} → ${d.max_block}`);
    }
    
    // Check if table might be corrupted
    console.log('\n🔧 Checking table structure...');
    const schemaResult = await clickhouse.query({
      query: `DESC erc1155_transfers`,
      format: 'JSONEachRow',
    });
    
    const schema = await schemaResult.json<any>();
    console.log(`Columns: ${schema.length}`);
    schema.forEach((col: any) => {
      console.log(`  ${col.name}: ${col.type}`);
    });
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

check();
