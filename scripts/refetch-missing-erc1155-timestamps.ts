#!/usr/bin/env npx tsx
/**
 * Refetch missing ERC-1155 timestamps for uncovered blocks
 * Optimized for remaining ~49K blocks that don't have timestamps yet
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const RPC_URL = process.env.ALCHEMY_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo';
const WORKERS = 8;
const BATCH_SIZE = 64; // blocks per RPC call
const CHECKPOINT_FILE = './tmp/refetch-missing-erc1155-timestamps.checkpoint.json';

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: parseInt(process.env.CLICKHOUSE_PORT || '8123'),
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface CheckpointData {
  phase: string;
  timestamp: number;
  missingBlocks: number;
  fetchedBlocks: number;
  workers: Record<string, { lastBlock: string; blocksProcessed: number; complete: boolean }>;
}

async function getCheckpoint(): Promise<CheckpointData> {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {
    phase: 'fetch',
    timestamp: Date.now(),
    missingBlocks: 0,
    fetchedBlocks: 0,
    workers: {},
  };
}

async function saveCheckpoint(data: CheckpointData) {
  const dir = resolve(CHECKPOINT_FILE, '..');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}

async function getMissingBlocks(): Promise<number[]> {
  try {
    const result = await client.query({
      query: `
        SELECT DISTINCT e.block_number
        FROM erc1155_transfers e
        WHERE e.block_timestamp = toDateTime(0)
        ORDER BY e.block_number ASC
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json() as any[];
    return data.map((row: any) => parseInt(row.block_number));
  } catch (error) {
    console.error('Error fetching missing blocks:', error);
    return [];
  }
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
      if (result.result && result.result.timestamp) {
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

async function insertTimestamps(timestamps: Map<number, number>): Promise<void> {
  if (timestamps.size === 0) return;

  const rows = Array.from(timestamps.entries())
    .map(([blockNum, ts]) => ({ block_number: blockNum, block_timestamp: ts }));

  try {
    await client.insert({
      table: 'tmp_block_timestamps',
      values: rows,
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.error('Error inserting timestamps:', error);
  }
}

async function processWorker(workerId: number, allBlocks: number[], checkpoint: CheckpointData) {
  const blocksPerWorker = Math.ceil(allBlocks.length / WORKERS);
  const startIdx = workerId * blocksPerWorker;
  const endIdx = Math.min(startIdx + blocksPerWorker, allBlocks.length);
  const workerBlocks = allBlocks.slice(startIdx, endIdx);

  let processed = 0;
  const timestamps = new Map<number, number>();

  for (let i = 0; i < workerBlocks.length; i += BATCH_SIZE) {
    const batch = workerBlocks.slice(i, Math.min(i + BATCH_SIZE, workerBlocks.length));
    const batchTimestamps = await fetchBlockTimestampsBatch(batch);

    for (const [blockNum, ts] of batchTimestamps) {
      timestamps.set(blockNum, ts);
    }

    processed += batch.length;

    // Log progress every 500 blocks
    if (processed % 500 === 0) {
      console.log(`Worker ${workerId}: ${processed}/${workerBlocks.length} blocks`);
    }
  }

  // Insert all timestamps for this worker
  await insertTimestamps(timestamps);

  // Update checkpoint
  checkpoint.workers[workerId.toString()] = {
    lastBlock: workerBlocks[workerBlocks.length - 1].toString(),
    blocksProcessed: workerBlocks.length,
    complete: true,
  };

  checkpoint.fetchedBlocks += processed;
  await saveCheckpoint(checkpoint);

  console.log(`✅ Worker ${workerId} complete: ${processed} blocks`);
}

async function main() {
  console.log('🔄 Refetching missing ERC-1155 timestamps\n');

  // Get missing blocks
  console.log('📊 Identifying missing blocks...');
  const missingBlocks = await getMissingBlocks();
  console.log(`Found ${missingBlocks.length} blocks without timestamps\n`);

  if (missingBlocks.length === 0) {
    console.log('✅ All blocks have timestamps!');
    return;
  }

  const checkpoint = await getCheckpoint();
  checkpoint.phase = 'fetch_missing';
  checkpoint.timestamp = Date.now();
  checkpoint.missingBlocks = missingBlocks.length;
  checkpoint.fetchedBlocks = 0;
  await saveCheckpoint(checkpoint);

  // Process in parallel
  console.log(`⚙️  Starting ${WORKERS} workers...\n`);
  const workers = [];
  for (let i = 0; i < WORKERS; i++) {
    workers.push(processWorker(i, missingBlocks, checkpoint));
  }

  await Promise.all(workers);

  // Verify results
  console.log('\n📋 Verification:');
  const result = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(block_timestamp > toDateTime(0)) as with_ts,
        round(100.0 * countIf(block_timestamp > toDateTime(0)) / count(), 2) as coverage_percent
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json() as any[];
  console.log(JSON.stringify(data, null, 2));

  // Update checkpoint to finalize
  checkpoint.phase = 'complete';
  await saveCheckpoint(checkpoint);

  console.log('\n✅ Refetch complete!');
}

main().catch(console.error);
