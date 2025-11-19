#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function recover() {
  try {
    console.log('🔧 Direct SQL recovery approach\n');
    
    // Drop old
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS tmp_block_timestamps`,
    });
    
    // Create and populate in one atomic operation
    console.log('Creating and populating tmp_block_timestamps...\n');
    
    await clickhouse.query({
      query: `
        CREATE TABLE tmp_block_timestamps ENGINE = MergeTree()
        ORDER BY block_number AS
        SELECT DISTINCT 
          block_number,
          block_timestamp
        FROM default.erc1155_transfers
        WHERE block_timestamp > toDateTime(0)
        ORDER BY block_number
      `,
    });
    
    console.log('✅ Table created\n');
    
    // Verify
    const verifyResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          min(block_number) as min_block,
          max(block_number) as max_block,
          min(block_timestamp) as oldest,
          max(block_timestamp) as newest
        FROM tmp_block_timestamps
      `,
      format: 'JSONEachRow',
    });
    
    const verify = await verifyResult.json<any>();
    if (verify && verify[0]) {
      const v = verify[0];
      console.log(`📊 Recovered Data:`);
      console.log(`  Total timestamps: ${v.total}`);
      console.log(`  Block range: ${v.min_block} → ${v.max_block}`);
      console.log(`  Date range: ${v.oldest} → ${v.newest}\n`);
      
      // Calculate coverage
      const coverageResult = await clickhouse.query({
        query: `
          SELECT 
            count(DISTINCT t.block_number) as covered,
            count(DISTINCT f.block_number) as source,
            count(DISTINCT f.block_number) - count(DISTINCT t.block_number) as gap
          FROM pm_erc1155_flats f
          LEFT JOIN tmp_block_timestamps t ON f.block_number = t.block_number
        `,
        format: 'JSONEachRow',
      });
      
      const coverage = await coverageResult.json<any>();
      if (coverage && coverage[0]) {
        const c = coverage[0];
        const pct = (parseInt(c.covered) / parseInt(c.source) * 100).toFixed(2);
        console.log(`📈 Coverage Analysis:`);
        console.log(`  Source blocks: ${c.source}`);
        console.log(`  Covered blocks: ${c.covered}`);
        console.log(`  Missing blocks: ${c.gap}`);
        console.log(`  Coverage: ${pct}%\n`);
        
        if (parseInt(c.gap) > 0) {
          console.log(`⚠️  Still have ${c.gap} blocks without timestamps`);
          console.log(`    Need to fetch from RPC for remaining blocks\n`);
        } else {
          console.log(`🎉 100% coverage achieved!\n`);
        }
      }
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

recover();
