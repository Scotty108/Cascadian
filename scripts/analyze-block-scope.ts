#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function analyzeScope() {
  console.log('📊 Analyzing Block Scope for Timestamp Backfill\n');
  
  // Get distinct block count
  const distinctResult = await clickhouse.query({
    query: `
      SELECT 
        count(DISTINCT block_number) as unique_blocks,
        min(block_number) as min_block,
        max(block_number) as max_block,
        max(block_number) - min(block_number) as block_span
      FROM default.erc1155_transfers
    `,
    format: 'JSONEachRow',
  });

  const distinctData = await distinctResult.json<any>();
  console.log('Block Statistics:');
  console.log(`  Unique blocks: ${parseInt(distinctData[0].unique_blocks).toLocaleString()}`);
  console.log(`  Min block: ${parseInt(distinctData[0].min_block).toLocaleString()}`);
  console.log(`  Max block: ${parseInt(distinctData[0].max_block).toLocaleString()}`);
  console.log(`  Block span: ${parseInt(distinctData[0].block_span).toLocaleString()}`);
  console.log('');

  // Calculate work estimates
  const uniqueBlocks = parseInt(distinctData[0].unique_blocks);
  const workers = 32;
  const blocksPerWorker = Math.ceil(uniqueBlocks / workers);
  const estimatedRpcTime = (blocksPerWorker * 150) / 1000; // 150ms per RPC call
  
  console.log('Work Estimates:');
  console.log(`  Workers: ${workers}`);
  console.log(`  Blocks per worker: ${blocksPerWorker.toLocaleString()}`);
  console.log(`  Est. time per worker: ${estimatedRpcTime.toFixed(1)}s`);
  console.log(`  Est. total fetch time: ${(estimatedRpcTime / 60).toFixed(1)} min (with parallelism)`);
  console.log('');

  // Sample a few blocks to verify timestamp issue
  console.log('Sample Data (verify epoch zero issue):');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT 
        block_number,
        block_timestamp,
        count(*) as transfer_count
      FROM default.erc1155_transfers
      WHERE block_number IN (
        SELECT DISTINCT block_number 
        FROM default.erc1155_transfers 
        ORDER BY block_number DESC 
        LIMIT 5
      )
      GROUP BY block_number, block_timestamp
      ORDER BY block_number DESC
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await sampleResult.json<any>();
  sampleData.forEach((row: any) => {
    console.log(`  Block ${row.block_number}: ${row.block_timestamp} (${row.transfer_count} transfers)`);
  });
}

analyzeScope();
