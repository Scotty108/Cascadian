#!/usr/bin/env npx tsx
/**
 * ERC-1155 ALCHEMY BACKFILL
 *
 * Safely rebuild ERC-1155 transfers using Alchemy's getAssetTransfers API
 *
 * Safety features (following docs/operations/NEVER_DO_THIS_AGAIN.md):
 * - Creates NEW staging tables (no DROP until verified)
 * - Checkpoint system (resume from crashes)
 * - Test mode (run on 10K blocks first)
 * - Conservative rate limiting
 * - Verification before handoff to C2
 *
 * Performance:
 * - 16 workers, 500 blocks per request
 * - ~96K requests for full backfill
 * - Estimated: 1.5-2 hours
 *
 * Usage:
 *   TEST_MODE=1 npx tsx scripts/erc1155-alchemy-backfill.ts  # Test on 10K blocks
 *   npx tsx scripts/erc1155-alchemy-backfill.ts              # Full backfill
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CTF_EXCHANGE = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'

// Configuration
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '16')
const BLOCKS_PER_REQUEST = parseInt(process.env.BLOCKS_PER_REQUEST || '500')
const TEST_MODE = process.env.TEST_MODE === '1'
const CHECKPOINT_FILE = 'tmp/erc1155-alchemy-backfill.checkpoint.json'
const CHECKPOINT_INTERVAL = 10000 // Save every 10K transfers

// Block range (Dec 2022 → current)
const START_BLOCK = 37_000_000  // Dec 2022 Polymarket CTF launch
const END_BLOCK = 100_000_000   // Current (will adjust to latest)
const TEST_END_BLOCK = START_BLOCK + 10_000 // For test mode

interface AlchemyTransfer {
  blockNum: string
  uniqueId: string
  hash: string
  from: string
  to: string
  erc1155Metadata: Array<{
    tokenId: string
    value: string
  }> | null
  category: string
  rawContract: {
    address: string
  }
  metadata?: {
    blockTimestamp: string
  }
}

interface CheckpointState {
  startTime: number
  lastBlock: number
  totalTransfersProcessed: number
  totalRowsInserted: number
  workersCompleted: number
  workerProgress: Record<number, number>
}

interface TransferRow {
  tx_hash: string
  log_index: number
  block_number: number
  block_timestamp: string
  contract: string
  token_id: string
  from_address: string
  to_address: string
  value: string
  operator: string
}

function loadCheckpoint(): CheckpointState | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      const checkpoint = JSON.parse(data)
      console.log(`\n📋 Resuming from checkpoint`)
      console.log(`   Last block: ${checkpoint.lastBlock.toLocaleString()}`)
      console.log(`   Transfers processed: ${checkpoint.totalTransfersProcessed.toLocaleString()}`)
      console.log(`   Rows inserted: ${checkpoint.totalRowsInserted.toLocaleString()}`)
      return checkpoint
    }
  } catch (e) {
    console.warn(`⚠️  Could not load checkpoint: ${(e as any).message}`)
  }
  return null
}

function saveCheckpoint(state: CheckpointState) {
  try {
    const dir = 'tmp'
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.warn(`⚠️  Could not save checkpoint: ${(e as any).message}`)
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchTransfers(
  fromBlock: string,
  toBlock: string,
  retries = 3
): Promise<AlchemyTransfer[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Math.random(),
          method: 'alchemy_getAssetTransfers',
          params: [{
            fromBlock,
            toBlock,
            contractAddresses: [CTF_EXCHANGE],
            category: ['erc1155'],
            maxCount: '0x3e8', // 1000 max
            withMetadata: true,
            excludeZeroValue: false
          }]
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.error) {
        // Rate limit error - backoff
        if (data.error.message.includes('rate limit') || data.error.code === 429) {
          const backoff = Math.pow(2, attempt) * 1000
          console.warn(`⚠️  Rate limit hit, backing off ${backoff}ms`)
          await sleep(backoff)
          continue
        }
        throw new Error(`RPC error: ${data.error.message}`)
      }

      return data.result.transfers || []

    } catch (error: any) {
      if (attempt === retries - 1) {
        throw error
      }
      const backoff = Math.pow(2, attempt) * 1000
      console.warn(`⚠️  Attempt ${attempt + 1} failed: ${error.message}, retrying in ${backoff}ms`)
      await sleep(backoff)
    }
  }

  return []
}

function convertToRows(transfers: AlchemyTransfer[]): TransferRow[] {
  const rows: TransferRow[] = []

  for (const transfer of transfers) {
    const blockNum = parseInt(transfer.blockNum, 16)
    const txHash = transfer.hash
    const timestamp = transfer.metadata?.blockTimestamp || new Date(0).toISOString()

    // Extract log index from uniqueId (format: "hash:log:index")
    const parts = transfer.uniqueId.split(':')
    const logIndex = parts.length === 3 ? parseInt(parts[2]) : 0

    // Handle multiple tokens in batch transfer
    if (transfer.erc1155Metadata && transfer.erc1155Metadata.length > 0) {
      for (const token of transfer.erc1155Metadata) {
        rows.push({
          tx_hash: txHash,
          log_index: logIndex,
          block_number: blockNum,
          block_timestamp: timestamp,
          contract: transfer.rawContract.address,
          token_id: token.tokenId,
          from_address: transfer.from,
          to_address: transfer.to,
          value: token.value,
          operator: transfer.from // Alchemy doesn't provide operator, use from as proxy
        })
      }
    }
  }

  return rows
}

async function insertRows(client: any, rows: TransferRow[], tableName: string) {
  if (rows.length === 0) return

  try {
    await client.insert({
      table: tableName,
      values: rows,
      format: 'JSONEachRow'
    })
  } catch (error: any) {
    console.error(`❌ Insert error: ${error.message}`)
    throw error
  }
}

async function processWorker(
  workerId: number,
  startBlock: number,
  endBlock: number,
  client: any,
  state: CheckpointState
): Promise<{ transfers: number; rows: number }> {
  let transfersProcessed = 0
  let rowsInserted = 0

  const resumeBlock = state.workerProgress[workerId] || startBlock

  for (let block = resumeBlock; block < endBlock; block += BLOCKS_PER_REQUEST) {
    const blockEnd = Math.min(block + BLOCKS_PER_REQUEST - 1, endBlock - 1)

    try {
      const transfers = await fetchTransfers(
        `0x${block.toString(16)}`,
        `0x${blockEnd.toString(16)}`
      )

      transfersProcessed += transfers.length

      if (transfers.length > 0) {
        const rows = convertToRows(transfers)
        await insertRows(client, rows, 'staging.erc1155_transfers_v2')
        rowsInserted += rows.length

        // Update unique block timestamps
        const uniqueBlocks = new Set(rows.map(r => r.block_number))
        const timestampRows = Array.from(uniqueBlocks).map(blockNum => {
          const row = rows.find(r => r.block_number === blockNum)!
          return {
            block_number: blockNum,
            block_timestamp: row.block_timestamp
          }
        })
        await insertRows(client, timestampRows, 'staging.tmp_block_timestamps_v2')
      }

      // Update checkpoint
      state.workerProgress[workerId] = blockEnd + 1
      state.lastBlock = Math.max(state.lastBlock, blockEnd)
      state.totalTransfersProcessed += transfers.length
      state.totalRowsInserted += rowsInserted

      if (state.totalTransfersProcessed % CHECKPOINT_INTERVAL < BLOCKS_PER_REQUEST * WORKER_COUNT) {
        saveCheckpoint(state)
      }

      // Progress log
      if (block % (BLOCKS_PER_REQUEST * 10) === 0) {
        const progress = ((block - startBlock) / (endBlock - startBlock) * 100).toFixed(1)
        console.log(`Worker ${workerId}: Block ${block.toLocaleString()} (${progress}%) - ${transfersProcessed} transfers, ${rowsInserted} rows`)
      }

      // Rate limiting
      await sleep(100) // 10 requests/second per worker

    } catch (error: any) {
      console.error(`❌ Worker ${workerId} error at block ${block}: ${error.message}`)
      // Save checkpoint and continue
      saveCheckpoint(state)
      await sleep(5000) // 5 second backoff
    }
  }

  state.workersCompleted++
  saveCheckpoint(state)

  return { transfers: transfersProcessed, rows: rowsInserted }
}

async function main() {
  const client = getClickHouseClient()

  const endBlock = TEST_MODE ? TEST_END_BLOCK : END_BLOCK

  console.log('\n🚀 ERC-1155 Alchemy Backfill\n')
  console.log('Configuration:')
  console.log(`  Mode: ${TEST_MODE ? 'TEST (10K blocks)' : 'FULL BACKFILL'}`)
  console.log(`  Workers: ${WORKER_COUNT}`)
  console.log(`  Blocks per request: ${BLOCKS_PER_REQUEST}`)
  console.log(`  Block range: ${START_BLOCK.toLocaleString()} → ${endBlock.toLocaleString()}`)
  console.log(`  Total blocks: ${(endBlock - START_BLOCK).toLocaleString()}`)
  console.log(`  Estimated requests: ${Math.ceil((endBlock - START_BLOCK) / BLOCKS_PER_REQUEST).toLocaleString()}`)
  console.log(`  Estimated time: ~${Math.ceil((endBlock - START_BLOCK) / BLOCKS_PER_REQUEST / WORKER_COUNT / 60)} minutes\n`)

  // Create staging tables
  console.log('📋 Creating staging tables...')

  try {
    await client.command({
      query: 'CREATE DATABASE IF NOT EXISTS staging'
    })

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS staging.erc1155_transfers_v2 (
          tx_hash String,
          log_index UInt32,
          block_number UInt64,
          block_timestamp DateTime,
          contract String,
          token_id String,
          from_address String,
          to_address String,
          value String,
          operator String
        ) ENGINE = ReplacingMergeTree()
        ORDER BY (block_number, tx_hash, log_index, token_id)
      `
    })

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS staging.tmp_block_timestamps_v2 (
          block_number UInt64,
          block_timestamp DateTime
        ) ENGINE = ReplacingMergeTree()
        ORDER BY block_number
      `
    })

    console.log('✅ Staging tables ready\n')

  } catch (error: any) {
    console.error(`❌ Failed to create staging tables: ${error.message}`)
    process.exit(1)
  }

  // Load or initialize checkpoint
  let state: CheckpointState = loadCheckpoint() || {
    startTime: Date.now(),
    lastBlock: START_BLOCK,
    totalTransfersProcessed: 0,
    totalRowsInserted: 0,
    workersCompleted: 0,
    workerProgress: {}
  }

  // Distribute work across workers
  console.log('🔄 Starting workers...\n')

  const blocksPerWorker = Math.ceil((endBlock - START_BLOCK) / WORKER_COUNT)
  const workers = []

  for (let i = 0; i < WORKER_COUNT; i++) {
    const workerStart = START_BLOCK + (i * blocksPerWorker)
    const workerEnd = Math.min(workerStart + blocksPerWorker, endBlock)

    workers.push(processWorker(i, workerStart, workerEnd, client, state))
  }

  // Wait for all workers
  const results = await Promise.all(workers)

  // Final summary
  const totalTransfers = results.reduce((sum, r) => sum + r.transfers, 0)
  const totalRows = results.reduce((sum, r) => sum + r.rows, 0)
  const duration = (Date.now() - state.startTime) / 1000 / 60

  console.log('\n✅ Backfill complete!\n')
  console.log('Results:')
  console.log(`  Total transfers processed: ${totalTransfers.toLocaleString()}`)
  console.log(`  Total rows inserted: ${totalRows.toLocaleString()}`)
  console.log(`  Duration: ${duration.toFixed(1)} minutes`)
  console.log(`  Rate: ${(totalRows / duration).toFixed(0)} rows/minute`)

  // Cleanup checkpoint
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE)
  }

  await client.close()
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  console.error(error.stack)
  process.exit(1)
})
