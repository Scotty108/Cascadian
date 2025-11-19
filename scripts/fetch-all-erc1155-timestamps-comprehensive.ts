#!/usr/bin/env npx tsx
/**
 * Comprehensive ERC-1155 Timestamp Fetch
 *
 * Fetches timestamps for ALL unique blocks from pm_erc1155_flats
 * (not just missing ones - ensures complete coverage)
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const RPC_URL = process.env.ALCHEMY_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo';
const WORKERS = 16;
const BATCH_SIZE = 64;
const CHECKPOINT_FILE = './tmp/fetch-all-erc1155-timestamps.checkpoint.json';

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: parseInt(process.env.CLICKHOUSE_PORT || '8123'),
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function getAllSourceBlocks(): Promise<number[]> {
  console.log('📖 Getting all unique source blocks...\n');
  const result = await client.query({
    query: `SELECT DISTINCT block_number FROM pm_erc1155_flats ORDER BY block_number ASC`,
    format: 'JSONEachRow',
  });

  const data = await result.json() as any[];
  return data.map((row: any) => parseInt(row.block_number));
}

async function fetchBlockTimestampsBatch(blockNumbers: number[]): Promise<Map<number, number>> {
  const requests = blockNumbers.map((blockNum) => ({
    jsonrpc: '2.0',
    method: 'eth_getBlockByNumber',
    params: [`0x${blockNum.toString(16)}`, false],
    id: blockNum,
  }));

  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests),
    });

    const results = (await response.json()) as any[];
    const timestamps = new Map<number, number>();

    results.forEach((result) => {
      if (result.result?.timestamp) {
        const blockNum = blockNumbers[results.indexOf(result)];
        const timestamp = parseInt(result.result.timestamp, 16);
        timestamps.set(blockNum, timestamp);
      }
    });

    return timestamps;
  } catch (error) {
    console.error('Error in batch fetch:', error);
    return new Map();
  }
}

async function processWorker(workerId: number, allBlocks: number[]): Promise<{ fetched: number; rows: any[] }> {
  const blocksPerWorker = Math.ceil(allBlocks.length / WORKERS);
  const startIdx = workerId * blocksPerWorker;
  const endIdx = Math.min(startIdx + blocksPerWorker, allBlocks.length);
  const workerBlocks = allBlocks.slice(startIdx, endIdx);

  let processed = 0;
  const rows: any[] = [];

  for (let i = 0; i < workerBlocks.length; i += BATCH_SIZE) {
    const batch = workerBlocks.slice(i, Math.min(i + BATCH_SIZE, workerBlocks.length));
    const batchTimestamps = await fetchBlockTimestampsBatch(batch);

    for (const [blockNum, ts] of batchTimestamps) {
      rows.push({ block_number: blockNum, block_timestamp: ts });
    }

    processed += batch.length;

    if (processed % 500 === 0) {
      console.log(`  Worker ${workerId}: ${processed}/${workerBlocks.length}`);
    }
  }

  console.log(`✅ Worker ${workerId}: ${processed} blocks, ${rows.length} timestamps`);
  return { fetched: processed, rows };
}

async function main() {
  console.log('🚀 Comprehensive ERC-1155 Timestamp Fetch\n');
  console.log('═'.repeat(50));

  // Get all source blocks
  const allBlocks = await getAllSourceBlocks();
  console.log(`Found ${allBlocks.length} unique blocks\n`);

  // Parallel fetch
  console.log(`⚙️  Starting ${WORKERS} workers...\n`);
  const workers = [];
  for (let i = 0; i < WORKERS; i++) {
    workers.push(processWorker(i, allBlocks));
  }

  const results = await Promise.all(workers);

  // Aggregate
  const allRows = results.flatMap(r => r.rows);
  const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);

  console.log(`\n✅ Fetch complete: ${allRows.length} timestamps from ${totalFetched} blocks`);

  // Clear and rebuild timestamp table
  console.log('\n💾 Rebuilding tmp_block_timestamps...');
  await client.query({ query: 'DROP TABLE IF EXISTS tmp_block_timestamps' });

  // Create fresh table
  await client.query({
    query: `
      CREATE TABLE tmp_block_timestamps (
        block_number UInt64,
        block_timestamp UInt32,
        fetched_at DateTime DEFAULT now()
      ) ENGINE = MergeTree()
      ORDER BY block_number
    `,
  });

  // Insert in batches
  const INSERT_BATCH = 10000;
  for (let i = 0; i < allRows.length; i += INSERT_BATCH) {
    const batch = allRows.slice(i, Math.min(i + INSERT_BATCH, allRows.length));
    await client.insert({
      table: 'tmp_block_timestamps',
      values: batch,
      format: 'JSONEachRow',
    });
    console.log(`  Inserted ${Math.min(i + INSERT_BATCH, allRows.length)}/${allRows.length}`);
  }

  console.log('✅ Table rebuilt\n');

  // Verify
  const verifyResult = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT block_number) as distinct_blocks,
        min(block_number) as min_block,
        max(block_number) as max_block
      FROM tmp_block_timestamps
    `,
    format: 'JSONEachRow',
  });

  const verify = await verifyResult.json();
  console.log('📊 tmp_block_timestamps status:');
  console.log(JSON.stringify(verify, null, 2));

  console.log('\n═'.repeat(50));
  console.log('✅ Complete! Ready for rebuild...\n');
}

main().catch(console.error);
