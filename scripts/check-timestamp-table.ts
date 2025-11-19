#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function check() {
  try {
    console.log('📋 Timestamp Staging Table Status\n');
    
    // Check tmp_block_timestamps
    const tmpResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          min(block_number) as min_block,
          max(block_number) as max_block,
          min(block_timestamp) as oldest_ts,
          max(block_timestamp) as newest_ts
        FROM default.tmp_block_timestamps
      `,
      format: 'JSONEachRow',
    });
    
    const tmpStats = await tmpResult.json<any>();
    if (tmpStats && tmpStats[0]) {
      const t = tmpStats[0];
      console.log(`tmp_block_timestamps:`);
      console.log(`  Total rows: ${t.total}`);
      if (parseInt(t.total) > 0) {
        console.log(`  Block range: ${t.min_block} → ${t.max_block}`);
        console.log(`  Timestamp range: ${t.oldest_ts} → ${t.newest_ts}`);
      } else {
        console.log(`  ⚠️  EMPTY TABLE`);
      }
    }
    
    // Calculate gap
    console.log('\n🔍 Coverage Analysis\n');
    const gapResult = await clickhouse.query({
      query: `
        SELECT 
          count(DISTINCT f.block_number) as source_blocks,
          count(DISTINCT t.block_number) as covered_blocks,
          count(DISTINCT f.block_number) - count(DISTINCT t.block_number) as missing_blocks
        FROM default.pm_erc1155_flats f
        LEFT JOIN default.tmp_block_timestamps t ON f.block_number = t.block_number
      `,
      format: 'JSONEachRow',
    });
    
    const gap = await gapResult.json<any>();
    if (gap && gap[0]) {
      const g = gap[0];
      console.log(`  Source blocks: ${g.source_blocks}`);
      console.log(`  With timestamps: ${g.covered_blocks}`);
      console.log(`  Missing: ${g.missing_blocks}`);
      const pct = (parseInt(g.covered_blocks) / parseInt(g.source_blocks) * 100).toFixed(2);
      console.log(`  Coverage: ${pct}%`);
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

check();
