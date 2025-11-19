#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function diagnose() {
  try {
    console.log('🔍 CRITICAL DIAGNOSIS: ERC-1155 Current State\n');
    
    // Check all ERC1155 related tables
    console.log('📋 Step 1: Listing all ERC1155 tables\n');
    const tablesResult = await clickhouse.query({
      query: `
        SELECT 
          name,
          type,
          engine,
          total_rows,
          total_bytes,
          formatReadableSize(total_bytes) as size_formatted
        FROM system.tables
        WHERE database = 'default' AND name LIKE '%erc1155%' OR name LIKE '%block_timestamp%'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow',
    });

    const tables = await tablesResult.json<any>();
    if (tables && tables.length > 0) {
      tables.forEach((t: any) => {
        console.log(`  ${t.name}:`);
        console.log(`    Engine: ${t.engine}`);
        console.log(`    Rows: ${t.total_rows}`);
        console.log(`    Size: ${t.size_formatted}`);
      });
    } else {
      console.log('  No ERC1155 tables found!');
    }
    
    console.log('\n📊 Step 2: Main table schema and data\n');
    
    // Get schema of main table
    const schemaResult = await clickhouse.query({
      query: `DESC default.erc1155_transfers`,
      format: 'JSONEachRow',
    });
    
    const schema = await schemaResult.json<any>();
    console.log('  erc1155_transfers columns:');
    schema.forEach((col: any) => {
      console.log(`    ${col.name}: ${col.type}`);
    });
    
    // Get data statistics
    console.log('\n  Data statistics:');
    const statsResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero,
          countIf(block_timestamp > toDateTime(0)) as with_real_ts,
          min(block_number) as min_block,
          max(block_number) as max_block,
          min(block_timestamp) as oldest_ts,
          max(block_timestamp) as newest_ts
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    
    const stats = await statsResult.json<any>();
    if (stats && stats[0]) {
      const s = stats[0];
      console.log(`    Total rows: ${s.total}`);
      console.log(`    Epoch zero: ${s.epoch_zero}`);
      console.log(`    With real timestamps: ${s.with_real_ts}`);
      console.log(`    Block range: ${s.min_block} → ${s.max_block}`);
      console.log(`    Timestamp range: ${s.oldest_ts} → ${s.newest_ts}`);
    }
    
    // Check source tables
    console.log('\n📊 Step 3: Source tables\n');
    
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
      console.log(`  pm_erc1155_flats:`);
      console.log(`    Total rows: ${pmStats[0].total}`);
      console.log(`    Block range: ${pmStats[0].min_block} → ${pmStats[0].max_block}`);
    }
    
    // Check timestamp staging table
    console.log('\n  Timestamp staging tables:');
    const tmpResult = await clickhouse.query({
      query: `
        SELECT 
          name,
          total_rows,
          formatReadableSize(total_bytes) as size_formatted
        FROM system.tables
        WHERE database = 'default' AND (
          name = 'tmp_block_timestamps' OR 
          name = 'tmp_block_timestamps_opt' OR
          name LIKE 'erc1155_transfers_%'
        )
      `,
      format: 'JSONEachRow',
    });
    
    const tmpTables = await tmpResult.json<any>();
    if (tmpTables && tmpTables.length > 0) {
      tmpTables.forEach((t: any) => {
        console.log(`    ${t.name}: ${t.total_rows} rows (${t.size_formatted})`);
      });
    } else {
      console.log('    None found');
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

diagnose();
