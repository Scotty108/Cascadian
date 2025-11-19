#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function findAll() {
  try {
    console.log('🔍 Searching for ALL ERC1155 table variants\n');
    
    // Get list of all tables
    const result = await clickhouse.query({
      query: `
        SELECT name, engine, total_rows
        FROM system.tables
        WHERE database = 'default'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow',
    });
    
    const tables = await result.json<any>();
    
    console.log('All tables in default database (sorted by size):');
    let foundErc1155 = false;
    
    for (const t of tables) {
      // Show all tables, highlighting ERC1155-related ones
      const isErc1155 = t.name.toLowerCase().includes('erc') || 
                        t.name.toLowerCase().includes('1155') ||
                        t.name.toLowerCase().includes('transfer') ||
                        t.name.toLowerCase().includes('timestamp');
      
      if (isErc1155) {
        foundErc1155 = true;
        console.log(`\n  ⭐ ${t.name}`);
        console.log(`     Rows: ${t.total_rows}`);
        console.log(`     Engine: ${t.engine}`);
        
        // Get block range if it has block_number column
        try {
          const blockResult = await clickhouse.query({
            query: `SELECT min(block_number) as min_b, max(block_number) as max_b FROM ${t.name} LIMIT 1`,
            format: 'JSONEachRow',
          });
          const blockData = await blockResult.json<any>();
          if (blockData && blockData[0] && blockData[0].min_b) {
            console.log(`     Block range: ${blockData[0].min_b} → ${blockData[0].max_b}`);
          }
        } catch (e) {
          // Skip if table doesn't have block_number
        }
      } else if (t.total_rows > 1000000) {
        // Show other large tables for context
        console.log(`  ${t.name}: ${t.total_rows} rows (${t.engine})`);
      }
    }
    
    if (!foundErc1155) {
      console.log('\n❌ No ERC1155-related tables found');
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
  }
}

findAll();
