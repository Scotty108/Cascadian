/**
 * Migrate Polymarket-Relevant USDC Flows from erc20_transfers_staging
 *
 * Source: igm38nvzub (388M rows raw USDC.e transfers)
 * Target: ja9egedrv0 (pm_erc20_usdc_flows - ~6.7M Polymarket-relevant rows)
 *
 * This script extracts ONLY USDC transfers involving the CTF contract
 * (minting deposits and payout redemptions) for V7 wallet ledger.
 *
 * Key Insight:
 * - CTF as FROM (topics[2]): 1.8M rows = USDC payouts to users
 * - CTF as TO (topics[3]): 4.9M rows = USDC deposits from users for minting
 *
 * Features:
 * - Decodes raw event logs to clean wallet + amount format
 * - Filters to Polymarket-relevant transfers only (CTF contract involvement)
 * - Batched processing with checkpoint recovery
 * - Parallel workers (4x) with crash protection
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import * as fs from 'fs';

const CHECKPOINT_FILE = '/tmp/erc20_usdc_flows_checkpoint.json';
const BATCH_SIZE = 100000;
const NUM_WORKERS = 4;

// Polymarket contract addresses
const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const CTF_PADDED = '0x000000000000000000000000' + CTF_CONTRACT.slice(2);

// Source database (old)
const sourceClient = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
  database: 'default',
  request_timeout: 300000
});

// Target database (new)
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
  console.log('Creating target table pm_erc20_usdc_flows...');

  await targetClient.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_erc20_usdc_flows (
        tx_hash String,
        log_index UInt32,
        block_number UInt64,
        from_address LowCardinality(String),
        to_address LowCardinality(String),
        amount_usdc Float64,
        flow_type Enum8('ctf_deposit' = 1, 'ctf_payout' = 2, 'other' = 0),
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
  // Get block range for CTF-involved transfers only
  const result = await sourceClient.query({
    query: `
      SELECT
        MIN(block_number) as min_block,
        MAX(block_number) as max_block
      FROM erc20_transfers_staging
      WHERE topics[2] = '${CTF_PADDED}' OR topics[3] = '${CTF_PADDED}'
    `,
    format: 'JSONEachRow'
  });
  const data = (await result.json() as any[])[0];
  return { min: parseInt(data.min_block), max: parseInt(data.max_block) };
}

async function getTotalRelevantRows(): Promise<number> {
  const result = await sourceClient.query({
    query: `
      SELECT count() as cnt
      FROM erc20_transfers_staging
      WHERE topics[2] = '${CTF_PADDED}' OR topics[3] = '${CTF_PADDED}'
    `,
    format: 'JSONEachRow'
  });
  return parseInt((await result.json() as any[])[0].cnt);
}

async function migrateBlockRange(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<number> {
  console.log(`[Worker ${workerId}] Processing blocks ${startBlock} to ${endBlock}`);

  // Read and decode from source
  // topics[2] = from address (padded), topics[3] = to address (padded)
  // data = amount in hex (256-bit)
  const result = await sourceClient.query({
    query: `
      SELECT
        tx_hash,
        log_index,
        block_number,
        lower(concat('0x', substring(topics[2], 27))) as from_address,
        lower(concat('0x', substring(topics[3], 27))) as to_address,
        reinterpretAsUInt256(reverse(unhex(substring(data, 3)))) / 1000000.0 as amount_usdc,
        CASE
          WHEN topics[2] = '${CTF_PADDED}' THEN 'ctf_payout'
          WHEN topics[3] = '${CTF_PADDED}' THEN 'ctf_deposit'
          ELSE 'other'
        END as flow_type
      FROM erc20_transfers_staging
      WHERE block_number >= ${startBlock}
        AND block_number < ${endBlock}
        AND (topics[2] = '${CTF_PADDED}' OR topics[3] = '${CTF_PADDED}')
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
    table: 'pm_erc20_usdc_flows',
    values: rows,
    format: 'JSONEachRow'
  });

  console.log(`[Worker ${workerId}] Inserted ${rows.length} rows`);
  return rows.length;
}

async function main() {
  console.log('=== POLYMARKET USDC FLOWS MIGRATION ===');
  console.log('');
  console.log('Migrating CTF-involved USDC transfers from 388M row staging table');
  console.log('');

  // Get relevant row count
  const totalRows = await getTotalRelevantRows();
  console.log(`Total Polymarket-relevant rows: ${totalRows.toLocaleString()}`);

  // Create target table
  await createTargetTable();

  // Get block ranges (for CTF-involved transfers only)
  const { min: minBlock, max: maxBlock } = await getBlockRanges();
  console.log(`Block range: ${minBlock} to ${maxBlock}`);

  // Load checkpoint
  let checkpoint = loadCheckpoint();
  const startBlock = checkpoint ? checkpoint.lastBlockNumber : minBlock;
  let totalProcessed = checkpoint ? checkpoint.rowsProcessed : 0;

  console.log(`Starting from block: ${startBlock}, rows processed: ${totalProcessed}`);
  console.log('');

  // Calculate block ranges for workers
  const blocksPerBatch = 500000; // Larger batches since we're filtering to ~1.7% of data
  const startTime = Date.now();

  let currentBlock = startBlock;
  let stallCount = 0;
  let lastProcessed = totalProcessed;

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

    // Stall protection
    if (batchProcessed === 0) {
      stallCount++;
      if (stallCount > 10) {
        console.log('Warning: No rows processed for 10 consecutive batches, checking if complete...');
        // May have gaps in block numbers, continue
        stallCount = 0;
      }
    } else {
      stallCount = 0;
    }

    currentBlock = batchEndBlock;
    lastProcessed = totalProcessed;
  }

  console.log('');
  console.log('=== MIGRATION COMPLETE ===');
  console.log(`Total rows migrated: ${totalProcessed.toLocaleString()}`);

  // Verify count in target
  const targetCount = await targetClient.query({
    query: 'SELECT count() as cnt FROM pm_erc20_usdc_flows',
    format: 'JSONEachRow'
  });
  const targetTotal = (await targetCount.json() as any[])[0].cnt;
  console.log(`Target table count: ${targetTotal}`);

  // Show flow type breakdown
  console.log('');
  console.log('=== FLOW TYPE BREAKDOWN ===');
  const breakdown = await targetClient.query({
    query: 'SELECT flow_type, count() as cnt, sum(amount_usdc) as total_usdc FROM pm_erc20_usdc_flows GROUP BY flow_type',
    format: 'JSONEachRow'
  });
  const breakdownData = await breakdown.json() as any[];
  for (const row of breakdownData) {
    console.log(`  ${row.flow_type}: ${Number(row.cnt).toLocaleString()} rows, $${Number(row.total_usdc).toLocaleString()} USDC`);
  }

  // Clean up checkpoint on success
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
  }

  await sourceClient.close();
  await targetClient.close();
}

main().catch(console.error);
