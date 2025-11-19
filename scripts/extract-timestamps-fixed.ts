#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function extract() {
  try {
    console.log('🔍 Fixed timestamp extraction\n');
    
    // Check column types first
    const descResult = await clickhouse.query({
      query: `DESC erc1155_transfers`,
      format: 'JSONEachRow',
    });
    
    const desc = await descResult.json<any>();
    console.log('Column types:');
    desc.forEach((col: any) => {
      if (col.name.includes('block') || col.name.includes('timestamp')) {
        console.log(`  ${col.name}: ${col.type}`);
      }
    });
    
    // Get sample data to understand structure
    console.log('\n📋 Sample data:');
    const sampleResult = await clickhouse.query({
      query: `
        SELECT 
          block_number,
          block_timestamp,
          toUnixTimestamp(block_timestamp) as unix_ts
        FROM erc1155_transfers
        WHERE block_timestamp > toDateTime(0)
        LIMIT 3
      `,
      format: 'JSONEachRow',
    });
    
    const sample = await sampleResult.json<any>();
    sample.forEach((row: any) => {
      console.log(`  Block ${row.block_number}: ${row.block_timestamp} (${row.unix_ts})`);
    });
    
    // Now rebuild tmp_block_timestamps correctly
    console.log('\n💾 Rebuilding tmp_block_timestamps...\n');
    
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS tmp_block_timestamps`,
    });
    
    // Use proper types matching the source
    await clickhouse.query({
      query: `
        CREATE TABLE tmp_block_timestamps (
          block_number UInt64,
          block_timestamp DateTime
        ) ENGINE = MergeTree()
        ORDER BY block_number
      `,
    });
    
    console.log('✅ Created table\n');
    
    // Extract with correct types
    console.log('Inserting timestamps...');
    
    const insertResult = await clickhouse.query({
      query: `
        SELECT DISTINCT 
          block_number,
          block_timestamp
        FROM default.erc1155_transfers
        WHERE block_timestamp > toDateTime(0)
        ORDER BY block_number
      `,
      format: 'JSONEachRow',
    });
    
    const extracted = await insertResult.json<any>();
    
    if (extracted && extracted.length > 0) {
      const BATCH_SIZE = 5000;
      for (let i = 0; i < extracted.length; i += BATCH_SIZE) {
        const batch = extracted.slice(i, Math.min(i + BATCH_SIZE, extracted.length));
        await clickhouse.insert({
          table: 'tmp_block_timestamps',
          values: batch,
          format: 'JSONEachRow',
        });
        console.log(`  ${Math.min(i + BATCH_SIZE, extracted.length)}/${extracted.length}`);
      }
      
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
        console.log(`\n✅ Recovered ${v.total} timestamps`);
        console.log(`  Block range: ${v.min_block} → ${v.max_block}`);
        console.log(`  Date range: ${v.oldest} → ${v.newest}`);
        
        // Calculate coverage
        const coverageResult = await clickhouse.query({
          query: `
            SELECT 
              (SELECT count(DISTINCT block_number) FROM tmp_block_timestamps) as covered,
              (SELECT count(DISTINCT block_number) FROM pm_erc1155_flats) as source
          `,
          format: 'JSONEachRow',
        });
        
        const coverage = await coverageResult.json<any>();
        if (coverage && coverage[0]) {
          const pct = (parseInt(coverage[0].covered) / parseInt(coverage[0].source) * 100).toFixed(2);
          console.log(`  Coverage: ${coverage[0].covered}/${coverage[0].source} (${pct}%)`);
        }
      }
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

extract();
