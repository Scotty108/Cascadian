/**
 * Migrate ERC1155 Transfers from Old Database to New Database
 *
 * Source: igm38nvzub.us-central1.gcp.clickhouse.cloud (61M rows)
 * Target: ja9egedrv0.us-central1.gcp.clickhouse.cloud
 *
 * Features:
 * - Batched processing (100K rows per batch)
 * - Progress tracking
 * - Crash protection with checkpoint
 * - Parallel workers
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import * as fs from 'fs';

const CHECKPOINT_FILE = '/tmp/erc1155_migration_checkpoint.json';
const BATCH_SIZE = 100000;
const NUM_WORKERS = 4;

// Old database (source)
const sourceClient = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default',
  request_timeout: 300000
});

// New database (target)
const targetClient = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 300000
});

interface Checkpoint {
  lastBlockNumber: number;
  rowsProcessed: number;
  lastUpdateTime: string;
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
  } catch (e) {
    console.log('No checkpoint found, starting fresh');
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function createTargetTable(): Promise<void> {
  console.log('Creating target table...');

  await targetClient.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_erc1155_transfers (
        tx_hash String,
        log_index UInt32,
        block_number UInt64,
        block_timestamp DateTime,
        contract String,
        token_id String,
        from_address String,
        to_address String,
        value String,
        operator String,
        is_deleted UInt8 DEFAULT 0
      )
      ENGINE = ReplacingMergeTree(is_deleted)
      ORDER BY (tx_hash, log_index)
      SETTINGS index_granularity = 8192
    `
  });

  console.log('Target table created/verified.');
}

async function getBlockRanges(): Promise<{ min: number, max: number }> {
  const result = await sourceClient.query({
    query: 'SELECT MIN(block_number) as min_block, MAX(block_number) as max_block FROM erc1155_transfers',
    format: 'JSONEachRow'
  });
  const data = (await result.json() as any[])[0];
  return { min: parseInt(data.min_block), max: parseInt(data.max_block) };
}

async function migrateBlockRange(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<number> {
  console.log(`[Worker ${workerId}] Processing blocks ${startBlock} to ${endBlock}`);

  // Read from source
  const result = await sourceClient.query({
    query: `
      SELECT
        tx_hash,
        log_index,
        block_number,
        block_timestamp,
        contract,
        token_id,
        from_address,
        to_address,
        value,
        operator
      FROM erc1155_transfers
      WHERE block_number >= ${startBlock} AND block_number < ${endBlock}
      ORDER BY block_number, tx_hash, log_index
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  if (rows.length === 0) {
    return 0;
  }

  // Insert into target
  await targetClient.insert({
    table: 'pm_erc1155_transfers',
    values: rows,
    format: 'JSONEachRow'
  });

  console.log(`[Worker ${workerId}] Inserted ${rows.length} rows`);
  return rows.length;
}

async function main() {
  console.log('=== ERC1155 TRANSFERS MIGRATION ===');
  console.log('');

  // Get total count
  const countResult = await sourceClient.query({
    query: 'SELECT COUNT(*) as cnt FROM erc1155_transfers',
    format: 'JSONEachRow'
  });
  const totalRows = parseInt((await countResult.json() as any[])[0].cnt);
  console.log(`Total rows to migrate: ${totalRows.toLocaleString()}`);

  // Create target table
  await createTargetTable();

  // Get block ranges
  const { min: minBlock, max: maxBlock } = await getBlockRanges();
  console.log(`Block range: ${minBlock} to ${maxBlock}`);

  // Load checkpoint
  let checkpoint = loadCheckpoint();
  const startBlock = checkpoint ? checkpoint.lastBlockNumber : minBlock;
  let totalProcessed = checkpoint ? checkpoint.rowsProcessed : 0;

  console.log(`Starting from block: ${startBlock}, rows processed: ${totalProcessed}`);
  console.log('');

  // Calculate block ranges for workers
  const blocksPerBatch = 100000; // Process 100K blocks at a time across workers
  const startTime = Date.now();

  let currentBlock = startBlock;

  while (currentBlock < maxBlock) {
    const batchEndBlock = Math.min(currentBlock + blocksPerBatch, maxBlock);
    const blockRangePerWorker = Math.ceil((batchEndBlock - currentBlock) / NUM_WORKERS);

    // Run workers in parallel
    const promises: Promise<number>[] = [];

    for (let i = 0; i < NUM_WORKERS; i++) {
      const workerStart = currentBlock + (i * blockRangePerWorker);
      const workerEnd = Math.min(workerStart + blockRangePerWorker, batchEndBlock);

      if (workerStart < batchEndBlock) {
        promises.push(migrateBlockRange(workerStart, workerEnd, i + 1));
      }
    }

    const results = await Promise.all(promises);
    const batchProcessed = results.reduce((a, b) => a + b, 0);
    totalProcessed += batchProcessed;

    // Save checkpoint
    saveCheckpoint({
      lastBlockNumber: batchEndBlock,
      rowsProcessed: totalProcessed,
      lastUpdateTime: new Date().toISOString()
    });

    const elapsed = (Date.now() - startTime) / 1000;
    const rowsPerSec = Math.round(totalProcessed / elapsed);
    const pct = ((totalProcessed / totalRows) * 100).toFixed(2);

    console.log(`Progress: ${totalProcessed.toLocaleString()} / ${totalRows.toLocaleString()} (${pct}%) | ${rowsPerSec} rows/sec`);

    currentBlock = batchEndBlock;
  }

  console.log('');
  console.log('=== MIGRATION COMPLETE ===');
  console.log(`Total rows migrated: ${totalProcessed.toLocaleString()}`);

  // Verify count in target
  const targetCount = await targetClient.query({
    query: 'SELECT COUNT(*) as cnt FROM pm_erc1155_transfers',
    format: 'JSONEachRow'
  });
  const targetTotal = (await targetCount.json() as any[])[0].cnt;
  console.log(`Target table count: ${targetTotal}`);

  // Clean up checkpoint
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
  }

  await sourceClient.close();
  await targetClient.close();
}

main().catch(console.error);
