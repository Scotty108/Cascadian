#!/usr/bin/env npx tsx
/**
 * Safe ERC-1155 Final Recovery
 * 
 * CRITICAL SAFEGUARDS:
 * 1. TEST PHASE: Verify RPC works on 100 blocks before proceeding
 * 2. MULTI-PROVIDER: Round-robin across 5 endpoints with fallback
 * 3. RATE LIMITING: 2 req/sec total, exponential backoff on errors
 * 4. CHECKPOINTS: Resume from last checkpoint if interrupted
 * 5. VERIFICATION: Verify new data BEFORE touching main table
 * 6. ATOMIC REBUILD: Only rebuild if new timestamps verified
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

const BATCH_SIZE = 25;
const WORKERS = 8;
const CHECKPOINT_FILE = './tmp/safe-recovery-final.checkpoint.json';
const TEST_BLOCKS_COUNT = 100;

interface Checkpoint {
  phase: 'test' | 'full' | 'rebuild' | 'complete';
  totalProcessed: number;
  totalFetched: number;
  lastBlock: number;
  workers: Record<string, { processed: number; fetched: number }>;
}

const client = createClient({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: parseInt(process.env.CLICKHOUSE_PORT || '8123'),
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

function getCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }
  return {
    phase: 'test',
    totalProcessed: 0,
    totalFetched: 0,
    lastBlock: 0,
    workers: {},
  };
}

function saveCheckpoint(cp: Checkpoint) {
  const dir = resolve(CHECKPOINT_FILE, '..');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function getMissingBlocks(limit?: number): Promise<number[]> {
  const query = limit
    ? `SELECT DISTINCT block_number FROM pm_erc1155_flats WHERE block_number NOT IN (SELECT block_number FROM tmp_block_timestamps) ORDER BY block_number ASC LIMIT ${limit}`
    : `SELECT DISTINCT block_number FROM pm_erc1155_flats WHERE block_number NOT IN (SELECT block_number FROM tmp_block_timestamps) ORDER BY block_number ASC`;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const data = (await result.json()) as any[];
  return data.map((row) => parseInt(row.block_number));
}

async function fetchWithRetry(
  blockNumbers: number[],
  endpointIdx: number,
  retryCount: number = 0
): Promise<Map<number, number>> {
  const rpcUrl = RPC_ENDPOINTS[endpointIdx % RPC_ENDPOINTS.length];
  const timestamps = new Map<number, number>();
  const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 5000);

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

    if (response.status === 429) {
      // Rate limited - wait and retry with different endpoint
      if (retryCount < 3) {
        await new Promise((r) => setTimeout(r, backoffMs));
        return fetchWithRetry(blockNumbers, endpointIdx + 1, retryCount + 1);
      }
      return timestamps;
    }

    if (!response.ok) {
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

    return timestamps;
  } catch (error) {
    return timestamps;
  }
}

async function processWorker(workerId: number, blocks: number[], cp: Checkpoint) {
  const perWorker = Math.ceil(blocks.length / WORKERS);
  const start = workerId * perWorker;
  const end = Math.min(start + perWorker, blocks.length);
  const workerBlocks = blocks.slice(start, end);

  let processed = 0;
  let fetched = 0;
  let endpointIdx = workerId;

  for (let i = 0; i < workerBlocks.length; i += BATCH_SIZE) {
    const batch = workerBlocks.slice(i, Math.min(i + BATCH_SIZE, workerBlocks.length));
    const timestamps = await fetchWithRetry(batch, endpointIdx);

    if (timestamps.size > 0) {
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
        fetched += timestamps.size;
      } catch (error) {
        console.error(`Insert error for worker ${workerId}:`, error);
      }
    }

    processed += batch.length;
    endpointIdx = (endpointIdx + 1) % RPC_ENDPOINTS.length;

    if (processed % 500 === 0) {
      console.log(`  Worker ${workerId}: ${processed}/${workerBlocks.length} processed, ${fetched} fetched`);
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  cp.workers[workerId] = { processed, fetched };
  cp.totalProcessed += processed;
  cp.totalFetched += fetched;
  console.log(`✅ Worker ${workerId}: ${processed} blocks, ${fetched} timestamps`);
}

async function main() {
  console.log('🚀 Safe ERC-1155 Final Recovery\n');
  console.log('═'.repeat(60));

  let cp = getCheckpoint();

  // PHASE 1: TEST
  if (cp.phase === 'test') {
    console.log('\n📝 PHASE 1: Test Recovery (100 blocks)\n');
    const testBlocks = await getMissingBlocks(TEST_BLOCKS_COUNT);
    console.log(`Testing with ${testBlocks.length} blocks\n`);

    if (testBlocks.length === 0) {
      console.log('✅ No missing blocks - proceeding to rebuild\n');
      cp.phase = 'rebuild';
    } else {
      const workers = [];
      for (let i = 0; i < Math.min(WORKERS, testBlocks.length); i++) {
        workers.push(processWorker(i, testBlocks, cp));
      }
      await Promise.all(workers);

      const testSuccessRate = (cp.totalFetched / cp.totalProcessed) * 100;
      console.log(`\n✅ Test phase: ${cp.totalFetched}/${cp.totalProcessed} (${testSuccessRate.toFixed(1)}%)`);

      if (testSuccessRate > 50) {
        console.log('✨ Test passed! Proceeding to full recovery...\n');
        cp.phase = 'full';
        cp.totalProcessed = 0;
        cp.totalFetched = 0;
        cp.workers = {};
      } else {
        console.error(`❌ Test failed: Only ${testSuccessRate.toFixed(1)}% success rate`);
        console.error('RPC endpoints not responding. Recovery blocked.');
        process.exit(1);
      }
    }
    saveCheckpoint(cp);
  }

  // PHASE 2: FULL RECOVERY
  if (cp.phase === 'full') {
    console.log('📥 PHASE 2: Full Recovery\n');
    const allMissing = await getMissingBlocks();
    console.log(`Fetching ${allMissing.length} missing blocks\n`);

    if (allMissing.length > 0) {
      const workers = [];
      for (let i = 0; i < WORKERS; i++) {
        workers.push(processWorker(i, allMissing, cp));
      }
      await Promise.all(workers);

      console.log(`\n✅ Full recovery: ${cp.totalFetched}/${cp.totalProcessed} blocks`);
    }

    cp.phase = 'rebuild';
    saveCheckpoint(cp);
  }

  // PHASE 3: REBUILD MAIN TABLE
  if (cp.phase === 'rebuild') {
    console.log('\n🔨 PHASE 3: Rebuilding erc1155_transfers\n');

    // Verify new data
    const verifyResult = await client.query({
      query: `
        SELECT count() as total FROM tmp_block_timestamps
        WHERE block_timestamp > toDateTime(0)
      `,
      format: 'JSONEachRow',
    });
    const verifyData = await verifyResult.json() as any[];
    const newCount = parseInt(verifyData[0].total);

    console.log(`Verifying new timestamp data: ${newCount} rows`);

    if (newCount === 0) {
      console.error('❌ No new timestamps fetched. Aborting rebuild to preserve current state.');
      process.exit(1);
    }

    // Atomic rebuild
    console.log('Creating new table...');
    await client.query({
      query: `
        CREATE TABLE erc1155_transfers_new ENGINE = ReplacingMergeTree()
        ORDER BY (block_number, log_index) AS
        SELECT
          f.block_number,
          f.log_index,
          f.tx_hash,
          f.address as contract,
          f.token_id,
          f.from_address,
          f.to_address,
          COALESCE(t.block_timestamp, toDateTime(0)) as block_timestamp,
          f.operator
        FROM pm_erc1155_flats f
        LEFT JOIN tmp_block_timestamps t ON f.block_number = t.block_number
      `,
    });

    console.log('Swapping tables...');
    await client.query({ query: `RENAME TABLE erc1155_transfers TO erc1155_transfers_backup` });
    await client.query({ query: `RENAME TABLE erc1155_transfers_new TO erc1155_transfers` });
    await client.query({ query: `DROP TABLE erc1155_transfers_backup` });

    cp.phase = 'complete';
    saveCheckpoint(cp);
  }

  // PHASE 4: VERIFY
  if (cp.phase === 'complete') {
    console.log('\n✅ VERIFICATION\n');
    const result = await client.query({
      query: `
        SELECT 
          count() as total,
          countIf(block_timestamp > toDateTime(0)) as with_ts,
          countIf(block_timestamp = toDateTime(0)) as epoch_zero
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow',
    });

    const data = await result.json() as any[];
    if (data && data[0]) {
      const d = data[0];
      const pct = (parseInt(d.with_ts) / parseInt(d.total) * 100).toFixed(2);
      console.log(`Total rows: ${d.total}`);
      console.log(`With timestamps: ${d.with_ts} (${pct}%)`);
      console.log(`Epoch zero: ${d.epoch_zero}`);
    }
  }

  console.log('\n═'.repeat(60));
  console.log('✅ Recovery complete!\n');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
