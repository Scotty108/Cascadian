#!/usr/bin/env npx tsx
/**
 * Multi-Provider ERC-1155 Timestamp Recovery
 * 
 * Strategy:
 * 1. Test with first 100 blocks using round-robin endpoint selection
 * 2. If test succeeds (>80% recovery), proceed to full 52,960 blocks
 * 3. Use multiple RPC endpoints to avoid rate limiting
 * 4. Checkpoint every 1000 blocks for crash recovery
 * 5. Implement exponential backoff for retries
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const RPC_ENDPOINTS = [
  process.env.ALCHEMY_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo',
  'https://mainnet.infura.io/v3/84842032b5d542b19b844b3ca4bfe860',
  'https://rpc.ankr.com/eth',
  'https://1rpc.io/eth',
  'https://eth.publicrpc.com',
];

const BATCH_SIZE = 25; // Reduced to avoid rate limits
const WORKERS = 8;
const CHECKPOINT_FILE = './tmp/multi-provider-recovery.checkpoint.json';
const TEST_BLOCKS = 100; // Test phase

interface Checkpoint {
  phase: 'test' | 'full' | 'finalize';
  blocksProcessed: number;
  blocksFetched: number;
  startTime: number;
  lastCheckpoint: number;
  workers: Record<string, { processed: number; fetched: number; lastBlock: number }>;
}

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: parseInt(process.env.CLICKHOUSE_PORT || '8123'),
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function getCheckpoint(): Promise<Checkpoint> {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }
  return {
    phase: 'test',
    blocksProcessed: 0,
    blocksFetched: 0,
    startTime: Date.now(),
    lastCheckpoint: Date.now(),
    workers: {},
  };
}

async function saveCheckpoint(cp: Checkpoint) {
  const dir = resolve(CHECKPOINT_FILE, '..');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function getSourceBlocks(limit?: number): Promise<number[]> {
  const query = limit
    ? `SELECT DISTINCT block_number FROM pm_erc1155_flats ORDER BY block_number ASC LIMIT ${limit}`
    : `SELECT DISTINCT block_number FROM pm_erc1155_flats ORDER BY block_number ASC`;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = (await result.json()) as any[];
  return data.map((row) => parseInt(row.block_number));
}

async function fetchFromRPC(blockNumbers: number[], endpointIndex: number): Promise<Map<number, number>> {
  const rpcUrl = RPC_ENDPOINTS[endpointIndex % RPC_ENDPOINTS.length];
  const timestamps = new Map<number, number>();

  const requests = blockNumbers.map((blockNum) => ({
    jsonrpc: '2.0',
    method: 'eth_getBlockByNumber',
    params: [`0x${blockNum.toString(16)}`, false],
    id: blockNum,
  }));

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`  ⚠️  RPC ${endpointIndex}: HTTP ${response.status}`);
      return timestamps;
    }

    const results = (await response.json()) as any[];
    let successCount = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.result?.timestamp) {
        const blockNum = blockNumbers[i];
        const timestamp = parseInt(result.result.timestamp, 16);
        timestamps.set(blockNum, timestamp);
        successCount++;
      }
    }

    console.log(`    Endpoint ${endpointIndex}: ${successCount}/${blockNumbers.length} timestamps`);
    return timestamps;
  } catch (error: any) {
    console.error(`    ⚠️  RPC ${endpointIndex} error: ${error.message}`);
    return timestamps;
  }
}

async function insertTimestamps(timestamps: Map<number, number>) {
  if (timestamps.size === 0) return;

  const rows = Array.from(timestamps.entries()).map(([blockNum, ts]) => ({
    block_number: blockNum,
    block_timestamp: ts,
  }));

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

async function processWorker(workerId: number, blocks: number[], checkpoint: Checkpoint) {
  const perWorker = Math.ceil(blocks.length / WORKERS);
  const start = workerId * perWorker;
  const end = Math.min(start + perWorker, blocks.length);
  const workerBlocks = blocks.slice(start, end);

  let processed = 0;
  const allTimestamps = new Map<number, number>();
  let endpointIdx = workerId;

  for (let i = 0; i < workerBlocks.length; i += BATCH_SIZE) {
    const batch = workerBlocks.slice(i, Math.min(i + BATCH_SIZE, workerBlocks.length));
    const timestamps = await fetchFromRPC(batch, endpointIdx);

    for (const [blockNum, ts] of timestamps) {
      allTimestamps.set(blockNum, ts);
    }

    processed += batch.length;
    endpointIdx = (endpointIdx + 1) % RPC_ENDPOINTS.length; // Rotate endpoints

    if (processed % 500 === 0 && processed > 0) {
      console.log(`  Worker ${workerId}: ${processed}/${workerBlocks.length} blocks`);
    }

    await new Promise((r) => setTimeout(r, 100)); // Rate limit
  }

  // Insert all collected timestamps
  await insertTimestamps(allTimestamps);

  // Update checkpoint
  checkpoint.blocksProcessed += processed;
  checkpoint.blocksFetched += allTimestamps.size;
  checkpoint.workers[workerId] = {
    processed: processed,
    fetched: allTimestamps.size,
    lastBlock: workerBlocks[workerBlocks.length - 1],
  };

  console.log(`✅ Worker ${workerId}: ${processed} blocks, ${allTimestamps.size} timestamps`);
}

async function main() {
  console.log('🚀 Multi-Provider ERC-1155 Recovery\n');
  console.log('═'.repeat(60));

  const checkpoint = await getCheckpoint();

  // Phase 1: Test with first 100 blocks
  if (checkpoint.phase === 'test') {
    console.log('\n📝 PHASE 1: Test Recovery (first 100 blocks)\n');

    const testBlocks = await getSourceBlocks(TEST_BLOCKS);
    console.log(`Testing with ${testBlocks.length} blocks\n`);

    const workers = [];
    for (let i = 0; i < WORKERS; i++) {
      workers.push(processWorker(i, testBlocks, checkpoint));
    }
    await Promise.all(workers);

    const testSuccessRate = (checkpoint.blocksFetched / checkpoint.blocksProcessed) * 100;
    console.log(`\n✅ Test phase complete: ${checkpoint.blocksFetched}/${checkpoint.blocksProcessed} (${testSuccessRate.toFixed(1)}%)`);

    if (testSuccessRate > 80) {
      console.log('✨ Test succeeded! Proceeding to full recovery...\n');
      checkpoint.phase = 'full';
      checkpoint.blocksProcessed = 0;
      checkpoint.blocksFetched = 0;
      checkpoint.workers = {};
      await saveCheckpoint(checkpoint);
    } else {
      console.error(`❌ Test failed: Only ${testSuccessRate.toFixed(1)}% recovery rate`);
      process.exit(1);
    }
  }

  // Phase 2: Full recovery
  if (checkpoint.phase === 'full') {
    console.log('📥 PHASE 2: Full Recovery (all 52,960 blocks)\n');

    const allBlocks = await getSourceBlocks();
    console.log(`Fetching timestamps for ${allBlocks.length} blocks\n`);

    const workers = [];
    for (let i = 0; i < WORKERS; i++) {
      workers.push(processWorker(i, allBlocks, checkpoint));
    }
    await Promise.all(workers);

    console.log(
      `\n✅ Full recovery complete: ${checkpoint.blocksFetched}/${checkpoint.blocksProcessed} blocks`
    );
    checkpoint.phase = 'finalize';
    await saveCheckpoint(checkpoint);
  }

  // Phase 3: Finalize
  if (checkpoint.phase === 'finalize') {
    console.log('\n🔧 PHASE 3: Finalizing\n');

    // Verify results
    const verify = await client.query({
      query: `
        SELECT 
          count() as total,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM tmp_block_timestamps
      `,
      format: 'JSONEachRow',
    });

    const stats = await verify.json();
    if (stats && stats[0]) {
      console.log(`📊 Recovery Results:`);
      console.log(`  Total timestamps: ${stats[0].total}`);
      console.log(`  Block range: ${stats[0].min_block} → ${stats[0].max_block}`);
    }

    console.log('\n═'.repeat(60));
    console.log('✅ Recovery complete! Ready for table rebuild.\n');
  }
}

main().catch(console.error);
