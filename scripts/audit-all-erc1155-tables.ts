#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function audit() {
  try {
    console.log('🔍 Complete ERC-1155 Table Audit\n');
    
    // Get ALL erc1155-related tables
    const tablesResult = await clickhouse.query({
      query: `
        SELECT name, count() as rows
        FROM system.tables t
        PREWHERE database = 'default' AND name LIKE '%erc%'
        GROUP BY name
        ORDER BY rows DESC
      `,
      format: 'JSONEachRow',
    });
    
    const tables = await tablesResult.json() as any[];
    
    console.log('All ERC1155 Tables:');
    for (const table of tables) {
      console.log(`  ${table.name}: ${table.rows} rows`);
      
      // Get min/max block numbers
      if (table.rows > 0) {
        const blockResult = await clickhouse.query({
          query: `SELECT min(block_number) as min_b, max(block_number) as max_b FROM ${table.name}`,
          format: 'JSONEachRow',
        });
        const blockData = await blockResult.json() as any[];
        if (blockData[0]) {
          console.log(`    Block range: ${blockData[0].min_b} → ${blockData[0].max_b}`);
        }
      }
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

audit();
