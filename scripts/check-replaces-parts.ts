#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function checkParts() {
  try {
    console.log('🔍 Checking ReplacingMergeTree parts for erc1155_transfers\n');
    
    const result = await clickhouse.query({
      query: `
        SELECT 
          partition,
          name,
          rows,
          marks,
          bytes_on_disk,
          active
        FROM system.parts
        WHERE database = 'default' AND table = 'erc1155_transfers'
        ORDER BY partition DESC
      `,
      format: 'JSONEachRow',
    });
    
    const parts = await result.json<any>();
    
    if (!parts || parts.length === 0) {
      console.log('No parts found - table might be empty or optimized');
      return;
    }
    
    console.log(`Found ${parts.length} parts:\n`);
    let totalRows = 0;
    
    for (const part of parts) {
      totalRows += parseInt(part.rows);
      const status = part.active ? '✅' : '❌';
      console.log(`${status} Partition ${part.partition}, Part: ${part.name}`);
      console.log(`   Rows: ${part.rows}, Bytes: ${part.bytes_on_disk}`);
    }
    
    console.log(`\nTotal rows across all parts: ${totalRows}`);
    
    if (totalRows !== 206112) {
      console.log(`⚠️  Mismatch! Expected 206112, got ${totalRows}`);
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

checkParts();
