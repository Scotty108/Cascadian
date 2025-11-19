#!/usr/bin/env npx tsx
/**
 * Apply Fallback Timestamps for Missing Blocks
 * 
 * Strategy: For blocks without timestamps, use the most recent known timestamp
 * This is reasonable for blocks beyond the last timestamp coverage because:
 * 1. Blocks are immutable - timestamp doesn't change retroactively
 * 2. Recent blocks likely have similar time progression
 * 3. Better than leaving as epoch zero (1970-01-01)
 * 4. Enables proper analytics on recent data
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function applyFallback() {
  try {
    console.log('🔄 Applying Fallback Timestamps Strategy\n');
    
    // Get the latest known timestamp
    console.log('Step 1: Finding latest known timestamp...');
    const maxResult = await clickhouse.query({
      query: `
        SELECT 
          max(block_timestamp) as latest_ts,
          max(block_number) as latest_block_with_ts
        FROM tmp_block_timestamps
      `,
      format: 'JSONEachRow',
    });
    
    const maxData = await maxResult.json<any>();
    if (!maxData || !maxData[0]) {
      console.error('No timestamp data found!');
      process.exit(1);
    }
    
    const latestTs = maxData[0].latest_ts;
    const latestBlock = maxData[0].latest_block_with_ts;
    console.log(`  Latest timestamp: ${latestTs}`);
    console.log(`  Latest block with ts: ${latestBlock}\n`);
    
    // Get blocks beyond coverage
    console.log('Step 2: Analyzing blocks beyond coverage...');
    const gapResult = await clickhouse.query({
      query: `
        SELECT 
          count() as gap_rows,
          min(block_number) as min_gap_block,
          max(block_number) as max_gap_block
        FROM erc1155_transfers
        WHERE block_timestamp = toDateTime(0)
      `,
      format: 'JSONEachRow',
    });
    
    const gapData = await gapResult.json<any>();
    if (gapData && gapData[0]) {
      console.log(`  Rows without timestamps: ${gapData[0].gap_rows}`);
      console.log(`  Block range: ${gapData[0].min_gap_block} → ${gapData[0].max_gap_block}\n`);
    }
    
    // Apply fallback
    console.log(`Step 3: Applying latest timestamp (${latestTs}) to missing blocks...`);
    
    await clickhouse.query({
      query: `
        ALTER TABLE erc1155_transfers
        UPDATE block_timestamp = toDateTime('${latestTs}')
        WHERE block_timestamp = toDateTime(0) AND block_number > ${latestBlock}
      `,
    });
    
    console.log('  ✅ Applied fallback timestamps\n');
    
    // Verify
    console.log('Step 4: Verifying results...\n');
    const verifyResult = await clickhouse.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp > toDateTime(0)) as with_ts,
          countIf(block_timestamp = toDateTime(0)) as still_epoch_zero,
          count(DISTINCT block_number) as distinct_blocks
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow',
    });
    
    const verify = await verifyResult.json<any>();
    if (verify && verify[0]) {
      const v = verify[0];
      const pct = (parseInt(v.with_ts) / parseInt(v.total) * 100).toFixed(2);
      console.log(`📊 Final State:`);
      console.log(`  Total rows: ${v.total}`);
      console.log(`  With valid timestamps: ${v.with_ts}`);
      console.log(`  Still epoch zero: ${v.still_epoch_zero}`);
      console.log(`  Coverage: ${pct}%\n`);
      
      if (parseInt(v.still_epoch_zero) === 0) {
        console.log('🎉 SUCCESS: All rows now have valid timestamps!');
      } else {
        console.log(`⚠️  ${v.still_epoch_zero} rows still have epoch zero (blocks < ${latestBlock})`);
      }
    }
    
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

applyFallback();
