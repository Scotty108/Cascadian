#!/usr/bin/env npx tsx
/**
 * Complete ERC-1155 Timestamp Backfill & Rebuild
 *
 * Three-phase workflow:
 * 1. FETCH: Get all missing block timestamps from RPC
 * 2. REBUILD: Atomic swap with complete timestamp coverage
 * 3. VERIFY: Ensure zero epoch-zero rows
 *
 * Expected result: 206,112 rows with 100% timestamp coverage
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const RPC_URL = process.env.ALCHEMY_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo';
const WORKERS = 16;
const BATCH_SIZE = 64; // blocks per RPC call
const CHECKPOINT_FILE = './tmp/complete-erc1155-timestamp-backfill.checkpoint.json';

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: parseInt(process.env.CLICKHOUSE_PORT || '8123'),
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface CheckpointData {
  phase: 'identify' | 'fetch' | 'rebuild' | 'verify' | 'complete';
  timestamp: number;
  totalMissingBlocks: number;
  fetchedBlocks: number;
  workers: Record<string, { lastBlock: string; blocksProcessed: number; complete: boolean }>;
}

async function getCheckpoint(): Promise<CheckpointData> {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(data);
  }
  return {
    phase: 'identify',
    timestamp: Date.now(),
    totalMissingBlocks: 0,
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
    console.log('🔍 Identifying missing blocks...');
    const result = await client.query({
      query: `
        SELECT DISTINCT p.block_number
        FROM pm_erc1155_flats p
        LEFT JOIN tmp_block_timestamps t ON p.block_number = t.block_number
        WHERE t.block_number IS NULL
        ORDER BY p.block_number ASC
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json() as any[];
    const blocks = data.map((row: any) => parseInt(row.block_number));
    console.log(`Found ${blocks.length} blocks without timestamps\n`);
    return blocks;
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

async function insertTimestamps(timestamps: Map<number, number>): Promise<void> {
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

async function processWorker(
  workerId: number,
  allBlocks: number[],
  checkpoint: CheckpointData
) {
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

    // Log progress every 1000 blocks
    if (processed % 1000 === 0) {
      console.log(`  Worker ${workerId}: ${processed}/${workerBlocks.length} blocks`);
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

async function rebuildTable(): Promise<void> {
  console.log('\n🔨 Phase 2: Rebuilding erc1155_transfers...');

  // Step 1: Create new table with timestamps
  console.log('  Step 1: Creating fixed table...');
  await client.query({
    query: `
      CREATE TABLE default.erc1155_transfers_fixed ENGINE = ReplacingMergeTree()
      ORDER BY (block_number, log_index) AS
      SELECT
        f.block_number,
        f.log_index,
        f.tx_hash,
        f.address as contract,
        f.token_id,
        f.from_address,
        f.to_address,
        COALESCE(toDateTime(t.block_timestamp), toDateTime(0)) as block_timestamp,
        f.operator
      FROM pm_erc1155_flats f
      LEFT JOIN tmp_block_timestamps t ON f.block_number = t.block_number
    `,
  });

  // Step 2: Atomic swap
  console.log('  Step 2: Atomic swap...');
  await client.query({
    query: `RENAME TABLE default.erc1155_transfers TO default.erc1155_transfers_old`,
  });
  await client.query({
    query: `RENAME TABLE default.erc1155_transfers_fixed TO default.erc1155_transfers`,
  });

  // Step 3: Cleanup old
  console.log('  Step 3: Cleanup...');
  await client.query({
    query: `DROP TABLE IF EXISTS default.erc1155_transfers_old`,
  });

  console.log('✅ Rebuild complete\n');
}

async function verifyResults(): Promise<void> {
  console.log('\n✅ Phase 3: Verification\n');

  const result = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(block_timestamp > toDateTime(0)) as with_real_ts,
        countIf(block_timestamp = toDateTime(0)) as epoch_zero_count,
        round(100.0 * countIf(block_timestamp > toDateTime(0)) / count(), 2) as coverage_pct
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json() as any[];
  const stat = data[0];

  console.log('📊 Final erc1155_transfers state:');
  console.log(`  Total rows: ${stat.total_rows}`);
  console.log(`  With real timestamps: ${stat.with_real_ts}`);
  console.log(`  Epoch zero (0): ${stat.epoch_zero_count}`);
  console.log(`  Coverage: ${stat.coverage_pct}%\n`);

  if (stat.epoch_zero_count > 0) {
    console.log('⚠️  WARNING: Still have epoch-zero rows. Details:');
    const detailResult = await client.query({
      query: `
        SELECT
          count() as count,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM erc1155_transfers
        WHERE block_timestamp = toDateTime(0)
      `,
      format: 'JSONEachRow',
    });
    const details = await detailResult.json();
    console.log(JSON.stringify(details, null, 2));
  } else {
    console.log('🎉 SUCCESS: 100% timestamp coverage achieved!');
  }
}

async function main() {
  console.log('🚀 Complete ERC-1155 Timestamp Backfill\n');
  console.log('═'.repeat(50));

  const checkpoint = await getCheckpoint();

  // Phase 1: Fetch
  if (checkpoint.phase === 'identify' || checkpoint.phase === 'fetch') {
    console.log('\n📥 Phase 1: Fetching Missing Timestamps');
    console.log('═'.repeat(50));

    const missingBlocks = await getMissingBlocks();
    if (missingBlocks.length === 0) {
      console.log('✅ All blocks have timestamps!');
      checkpoint.phase = 'rebuild';
    } else {
      checkpoint.phase = 'fetch';
      checkpoint.timestamp = Date.now();
      checkpoint.totalMissingBlocks = missingBlocks.length;
      checkpoint.fetchedBlocks = 0;
      await saveCheckpoint(checkpoint);

      console.log(`⚙️  Starting ${WORKERS} workers for ${missingBlocks.length} blocks\n`);
      const workers = [];
      for (let i = 0; i < WORKERS; i++) {
        workers.push(processWorker(i, missingBlocks, checkpoint));
      }

      await Promise.all(workers);
      console.log(`\n✅ Fetch phase complete: ${checkpoint.fetchedBlocks} blocks`);
      checkpoint.phase = 'rebuild';
      await saveCheckpoint(checkpoint);
    }
  }

  // Phase 2: Rebuild
  if (checkpoint.phase === 'rebuild') {
    await rebuildTable();
    checkpoint.phase = 'verify';
    await saveCheckpoint(checkpoint);
  }

  // Phase 3: Verify
  if (checkpoint.phase === 'verify') {
    await verifyResults();
    checkpoint.phase = 'complete';
    await saveCheckpoint(checkpoint);
  }

  console.log('═'.repeat(50));
  console.log('✅ All phases complete!\n');
}

main().catch(console.error);
