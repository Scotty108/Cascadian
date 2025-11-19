#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function diagnose() {
  try {
    console.log('🔍 CRITICAL DIAGNOSIS: ERC-1155 Current State\n');
    
    // Get main table stats
    console.log('📊 Main table: erc1155_transfers\n');
    const statsResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero,
          countIf(block_timestamp > toDateTime(0)) as with_real_ts,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    
    const stats = await statsResult.json<any>();
    if (stats && stats[0]) {
      const s = stats[0];
      console.log(`  Total rows: ${s.total}`);
      console.log(`  Epoch zero (1970-01-01): ${s.epoch_zero}`);
      console.log(`  With real timestamps: ${s.with_real_ts}`);
      console.log(`  Block range: ${s.min_block} → ${s.max_block}`);
      const pct = (parseInt(s.with_real_ts) / parseInt(s.total) * 100).toFixed(2);
      console.log(`  Coverage: ${pct}%`);
    }
    
    // Check source table
    console.log('\n📊 Source table: pm_erc1155_flats\n');
    const pmResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM default.pm_erc1155_flats
      `,
      format: 'JSONEachRow',
    });
    
    const pmStats = await pmResult.json<any>();
    if (pmStats && pmStats[0]) {
      console.log(`  Total rows: ${pmStats[0].total}`);
      console.log(`  Block range: ${pmStats[0].min_block} → ${pmStats[0].max_block}`);
    }
    
    // Check timestamp staging tables
    console.log('\n📋 Available timestamp tables\n');
    const tempResult = await clickhouse.query({
      query: `
        SELECT
          'tmp_block_timestamps' as table_name,
          count() as rows
        FROM default.tmp_block_timestamps
        UNION ALL
        SELECT
          'tmp_block_timestamps_opt',
          count()
        FROM default.tmp_block_timestamps_opt
      `,
      format: 'JSONEachRow',
    });
    
    const temps = await tempResult.json<any>();
    temps.forEach((t: any) => {
      console.log(`  ${t.table_name}: ${t.rows} rows`);
    });
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

diagnose();
