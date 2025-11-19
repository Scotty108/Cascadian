#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function extract() {
  try {
    console.log('🔍 Extracting existing timestamps from erc1155_transfers\n');
    
    // First check what we have
    const statsResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total_rows,
          countIf(block_timestamp > toDateTime(0)) as rows_with_ts,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero_rows,
          count(DISTINCT block_number) as distinct_blocks_with_ts
        FROM default.erc1155_transfers
        WHERE block_timestamp > toDateTime(0)
      `,
      format: 'JSONEachRow',
    });
    
    const stats = await statsResult.json<any>();
    if (stats && stats[0]) {
      console.log(`✅ Existing timestamps in erc1155_transfers:`);
      console.log(`  Rows with real timestamps: ${stats[0].rows_with_ts}`);
      console.log(`  Distinct blocks covered: ${stats[0].distinct_blocks_with_ts}`);
      console.log(`  Epoch zero rows: ${stats[0].epoch_zero_rows}\n`);
    }
    
    // Extract unique block → timestamp mapping
    console.log('💾 Rebuilding tmp_block_timestamps from erc1155_transfers...\n');
    
    await clickhouse.query({
      query: `
        DROP TABLE IF EXISTS tmp_block_timestamps
      `,
    });
    
    console.log('  Created new table');
    
    // Create fresh table
    await clickhouse.query({
      query: `
        CREATE TABLE tmp_block_timestamps (
          block_number UInt64,
          block_timestamp UInt32
        ) ENGINE = MergeTree()
        ORDER BY block_number
      `,
    });
    
    // Extract and insert
    console.log('  Inserting extracted timestamps...');
    
    const extractResult = await clickhouse.query({
      query: `
        SELECT DISTINCT 
          block_number,
          toUInt32(toUnixTimestamp(block_timestamp)) as block_timestamp
        FROM default.erc1155_transfers
        WHERE block_timestamp > toDateTime(0)
        ORDER BY block_number
      `,
      format: 'JSONEachRow',
    });
    
    const extracted = await extractResult.json<any>();
    
    if (extracted && extracted.length > 0) {
      // Insert in batches
      const BATCH_SIZE = 10000;
      for (let i = 0; i < extracted.length; i += BATCH_SIZE) {
        const batch = extracted.slice(i, Math.min(i + BATCH_SIZE, extracted.length));
        await clickhouse.insert({
          table: 'tmp_block_timestamps',
          values: batch,
          format: 'JSONEachRow',
        });
        console.log(`  Inserted ${Math.min(i + BATCH_SIZE, extracted.length)}/${extracted.length}`);
      }
      
      // Verify
      const verifyResult = await clickhouse.query({
        query: `
          SELECT 
            count() as total,
            min(block_number) as min_block,
            max(block_number) as max_block
          FROM tmp_block_timestamps
        `,
        format: 'JSONEachRow',
      });
      
      const verify = await verifyResult.json<any>();
      if (verify && verify[0]) {
        console.log(`\n✅ Recovery Successful!`);
        console.log(`  Recovered ${verify[0].total} block→timestamp mappings`);
        console.log(`  Block range: ${verify[0].min_block} → ${verify[0].max_block}`);
      }
    } else {
      console.log('⚠️  No data to extract');
    }
    
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

extract();
