#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';
import { createPublicClient, http, Log } from 'viem';

// ============================================================================
// Configuration
// ============================================================================

const TOTAL_DAYS = 1048;
const DAYS_PER_YEAR = 365.25;
const EARLIEST_TRADE_DATE = new Date('2022-12-18T10:45:22Z');
const LATEST_TRADE_DATE = new Date('2025-10-31T17:00:38Z');

// Batch settings for inserts
const BATCH_ROWS = Number(process.env.BATCH_ROWS ?? 5000);
const INSERT_RETRIES = 5;

// RPC URL rotation
const RPC_URLS = (process.env.ETHEREUM_RPC_URLS || process.env.ETHEREUM_RPC_URL || 'https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO')
  .split(',')
  .map((url) => url.trim());
let rpcIndex = 0;
const getRpcUrl = () => RPC_URLS[rpcIndex++ % RPC_URLS.length];

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';

const CTF_ADDRESS = '0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61' as const;
const USDC_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' as const;

const SHARDS = parseInt(process.env.SHARDS || '8', 10);
const SHARD_ID = parseInt(process.env.SHARD_ID || '0', 10);

// Transfer signatures
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC1155_TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595a9738d51b54330fc5';
const ERC1155_TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657706909c31c4caa39ffeab6ffa4a8fba';

// ============================================================================
// Initialize Clients
// ============================================================================

const chClient = createClient({
  host: CLICKHOUSE_HOST,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DATABASE,
  compression: { response: true },
});

// Create a function to get a fresh viem client with round-robin RPC
const createViemClientWithRPC = () =>
  createPublicClient({
    transport: http(getRpcUrl(), {
      retryCount: 1,
      retryDelay: 500,
    }),
  });

// ============================================================================
// Utility Functions
// ============================================================================

function getBlockRangesForDay(dayIdx: number): Array<{ fromBlock: number; toBlock: number }> {
  // Rough estimate: ~43,200 blocks per day on Polygon
  const BLOCKS_PER_DAY = 43200;
  const CHUNK_SIZE = 2000; // RPC recommended max

  const startBlock = dayIdx * BLOCKS_PER_DAY;
  const endBlock = startBlock + BLOCKS_PER_DAY - 1;

  const ranges = [];
  for (let from = startBlock; from <= endBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, endBlock);
    ranges.push({ fromBlock: from, toBlock: to });
  }

  return ranges;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLogsWithRetry(
  fromBlock: number,
  toBlock: number,
  address: string,
  topics: string[],
  attempt: number = 1,
): Promise<Log[]> {
  const maxAttempts = 2;
  try {
    const client = createViemClientWithRPC(); // Fresh client for round-robin RPC
    const logs = await client.getLogs({
      address: address as `0x${string}`,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
      topics: topics.length > 0 ? [topics] : undefined,
    });
    return logs;
  } catch (error) {
    if (attempt < maxAttempts) {
      const delayMs = Math.pow(2, attempt - 1) * 500; // Short backoff + RPC rotation
      console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  getLogs attempt ${attempt} failed, retrying with next RPC in ${delayMs}ms`);
      await sleep(delayMs);
      return fetchLogsWithRetry(fromBlock, toBlock, address, topics, attempt + 1);
    } else {
      console.log(
        `[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  getLogs failed after ${maxAttempts} attempts (blocks ${fromBlock}-${toBlock}), continuing without logs`,
      );
      return []; // Graceful degradation
    }
  }
}

// ============================================================================
// Checkpoint Functions
// ============================================================================

async function isDayComplete(dayIdx: number): Promise<boolean> {
  try {
    const result = await chClient.query({
      query: `SELECT status FROM backfill_checkpoint WHERE day_idx = ${dayIdx}`,
      format: 'JSONEachRow',
    });
    const text = await result.text();
    return text.includes('COMPLETE');
  } catch {
    return false;
  }
}

async function claimDay(dayIdx: number): Promise<boolean> {
  try {
    // Use insert method for better handling
    await chClient.insert({
      table: 'backfill_checkpoint',
      values: [
        {
          day_idx: dayIdx,
          status: 'STARTED',
          shard_id: SHARD_ID,
          created_at: new Date(),
        },
      ],
      format: 'JSONEachRow',
    });
    return true;
  } catch {
    return false;
  }
}

async function markDayComplete(dayIdx: number, erc20Count: number, erc1155Count: number): Promise<void> {
  try {
    await chClient.insert({
      table: 'backfill_checkpoint',
      values: [
        {
          day_idx: dayIdx,
          status: 'COMPLETE',
          shard_id: SHARD_ID,
          erc20_count: erc20Count,
          erc1155_count: erc1155Count,
          created_at: new Date(),
        },
      ],
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  Failed to mark day ${dayIdx} complete:`, error);
  }
}

async function updateHeartbeat(): Promise<void> {
  try {
    await chClient.insert({
      table: 'worker_heartbeats',
      values: [
        {
          worker_id: String(SHARD_ID),
          last_batch: new Date(),
          updated_at: new Date(),
        },
      ],
      format: 'JSONEachRow',
    });
  } catch {
    // Heartbeat failures are non-blocking
  }
}

async function insertWithRetry(table: string, rows: any[]): Promise<void> {
  for (let attempt = 1; attempt <= INSERT_RETRIES; attempt++) {
    try {
      await chClient.insert({
        table,
        values: rows,
        format: 'JSONEachRow',
      });
      return;
    } catch (e) {
      if (attempt === INSERT_RETRIES) {
        console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ❌ Insert to ${table} failed after ${INSERT_RETRIES} attempts:`, e);
        throw e;
      }
      const delayMs = 500 * Math.pow(2, attempt - 1);
      console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  Insert attempt ${attempt} failed, retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

// ============================================================================
// Main Backfill Loop
// ============================================================================

async function runBackfill(): Promise<void> {
  console.log(`
════════════════════════════════════════════════════════════════════════════════
[SHARD ${SHARD_ID}/${SHARDS}] MULTI-WORKER STREAMING TRANSFER BACKFILL
[SHARD ${SHARD_ID}/${SHARDS}] Configuration: SHARDS=${SHARDS}, SHARD_ID=${SHARD_ID}
[SHARD ${SHARD_ID}/${SHARDS}] RPC Endpoints: ${RPC_URLS.length} (round-robin)
[SHARD ${SHARD_ID}/${SHARDS}] CTF: ${CTF_ADDRESS}
[SHARD ${SHARD_ID}/${SHARDS}] USDC: ${USDC_ADDRESS}
[SHARD ${SHARD_ID}/${SHARDS}] ════════════════════════════════════════════════════════════════════════════════
`);

  // Verify tables exist
  try {
    await chClient.query({
      query: 'SELECT count() FROM erc20_transfers_staging LIMIT 1',
    });
    console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ✅ Tables ready\n`);
  } catch (error) {
    console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ❌ Tables not ready:`, error);
    process.exit(1);
  }

  const myDays = [];
  for (let i = SHARD_ID; i < TOTAL_DAYS; i += SHARDS) {
    myDays.push(i);
  }

  console.log(`[SHARD ${SHARD_ID}/${SHARDS}] 📋 Configuration:`);
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}]   Total days to process: ${TOTAL_DAYS}`);
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}]   Days this shard will process: ~${Math.ceil(myDays.length)}`);
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}]   Shard assignment: day_idx % ${SHARDS} == ${SHARD_ID}\n`);
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}] 🔄 Starting backfill (day-based sharding)...\n`);

  let totalErc20 = 0;
  let totalErc1155 = 0;

  for (const dayIdx of myDays) {
    // Check if already complete
    if (await isDayComplete(dayIdx)) {
      console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⏭️  Day ${dayIdx} already complete, skipping`);
      continue;
    }

    // Attempt to claim the day (prevents race conditions)
    if (!(await claimDay(dayIdx))) {
      console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  Day ${dayIdx} claimed by another worker, skipping`);
      continue;
    }

    try {
      const blockRanges = getBlockRangesForDay(dayIdx);

      // Fetch ERC20 transfers (across all chunks for the day)
      let erc20Logs: Log[] = [];
      try {
        for (const { fromBlock, toBlock } of blockRanges) {
          const logs = await fetchLogsWithRetry(fromBlock, toBlock, USDC_ADDRESS, [ERC20_TRANSFER_TOPIC]);
          erc20Logs = [...erc20Logs, ...logs];
        }
        totalErc20 += erc20Logs.length;
      } catch (error) {
        console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  Error fetching ERC20 logs for day ${dayIdx}:`, error);
      }

      // Fetch ERC1155 transfers (across all chunks for the day)
      let erc1155Logs: Log[] = [];
      try {
        for (const { fromBlock, toBlock } of blockRanges) {
          const singleTransfers = await fetchLogsWithRetry(fromBlock, toBlock, CTF_ADDRESS, [ERC1155_TRANSFER_SINGLE_TOPIC]);
          const batchTransfers = await fetchLogsWithRetry(fromBlock, toBlock, CTF_ADDRESS, [ERC1155_TRANSFER_BATCH_TOPIC]);
          erc1155Logs = [...erc1155Logs, ...singleTransfers, ...batchTransfers];
        }
        totalErc1155 += erc1155Logs.length;
      } catch (error) {
        console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ⚠️  Error fetching ERC1155 logs for day ${dayIdx}:`, error);
      }

      // Insert into ClickHouse with batching
      if (erc20Logs.length > 0) {
        const erc20Rows = erc20Logs.map((log) => ({
          tx_hash: log.transactionHash || '',
          log_index: log.logIndex || 0,
          block_number: Number(log.blockNumber || 0),
          block_hash: log.blockHash || '',
          address: log.address || '',
          topics: log.topics || [],
          data: log.data || '',
          removed: log.removed || false,
          token_type: 'ERC20',
          created_at: new Date(),
        }));

        // Insert in batches
        for (let i = 0; i < erc20Rows.length; i += BATCH_ROWS) {
          const batch = erc20Rows.slice(i, i + BATCH_ROWS);
          await insertWithRetry('erc20_transfers_staging', batch);
        }
      }

      if (erc1155Logs.length > 0) {
        const erc1155Rows = erc1155Logs.map((log) => ({
          tx_hash: log.transactionHash || '',
          log_index: log.logIndex || 0,
          block_number: Number(log.blockNumber || 0),
          block_hash: log.blockHash || '',
          address: log.address || '',
          topics: log.topics || [],
          data: log.data || '',
          removed: log.removed || false,
          token_type: 'ERC1155',
          created_at: new Date(),
        }));

        // Insert in batches
        for (let i = 0; i < erc1155Rows.length; i += BATCH_ROWS) {
          const batch = erc1155Rows.slice(i, i + BATCH_ROWS);
          await insertWithRetry('erc1155_transfers_staging', batch);
        }
      }

      // Mark day as complete
      await markDayComplete(dayIdx, erc20Logs.length, erc1155Logs.length);

      console.log(
        `[SHARD ${SHARD_ID}/${SHARDS}] ✅ Day ${dayIdx}: ERC20=${erc20Logs.length}, ERC1155=${erc1155Logs.length}`,
      );
    } catch (error) {
      console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ❌ Error processing day ${dayIdx}:`, error);
      // Continue with next day even if one fails
    }

    // Update heartbeat every 5 days
    if (dayIdx % 5 === 0) {
      await updateHeartbeat();
    }
  }

  console.log(`
[SHARD ${SHARD_ID}/${SHARDS}] ✅ BACKFILL COMPLETE
[SHARD ${SHARD_ID}/${SHARDS}] Total ERC20 transfers: ${totalErc20}
[SHARD ${SHARD_ID}/${SHARDS}] Total ERC1155 transfers: ${totalErc1155}
`);

  await chClient.close();
  process.exit(0);
}

// ============================================================================
// Error Handling & Execution
// ============================================================================

process.on('unhandledRejection', (reason, promise) => {
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ❌ Unhandled Rejection:`, reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ❌ Uncaught Exception:`, error);
  process.exit(1);
});

// Run backfill
runBackfill().catch((error) => {
  console.log(`[SHARD ${SHARD_ID}/${SHARDS}] ❌ Fatal error:`, error);
  process.exit(1);
});
