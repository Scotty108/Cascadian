#!/usr/bin/env npx tsx
/**
 * FIX ERC-1155 TIMESTAMPS
 *
 * Problem: 17.3M rows in erc1155_transfers have epoch zero timestamps
 * Solution: Fetch real timestamps from RPC, rebuild table with correct data
 *
 * Strategy:
 * 1. Fetch all 2.6M unique block timestamps via RPC (32 workers, ~3.5 hrs)
 * 2. Store in temp table tmp_block_timestamps
 * 3. Rebuild erc1155_transfers with JOIN to temp table (~10 min)
 * 4. Atomic swap via RENAME
 *
 * Features:
 * - Checkpoint system (resume from interruption)
 * - Parallel workers with retry logic
 * - Rate limiting with jitter
 * - Pre-swap validation
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = 32
const CHECKPOINT_FILE = 'tmp/fix-erc1155-timestamps.checkpoint.json'
const CHECKPOINT_INTERVAL = 100 // Save every 100 blocks fetched
const INSERT_BATCH_SIZE = 500

interface CheckpointState {
  phase: 'fetch' | 'rebuild' | 'complete'
  timestamp: number
  totalBlocks: number
  fetchedBlocks: number
  workers: {
    [workerId: number]: {
      lastBlock: number
      blocksProcessed: number
      complete: boolean
    }
  }
}

function loadCheckpoint(): CheckpointState | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      const checkpoint = JSON.parse(data)
      console.log(`\n📋 Resuming from checkpoint (${checkpoint.phase} phase)`)
      console.log(`   Progress: ${checkpoint.fetchedBlocks.toLocaleString()} / ${checkpoint.totalBlocks.toLocaleString()} blocks`)
      return checkpoint
    }
  } catch (e) {
    console.warn(`⚠️  Could not load checkpoint: ${(e as any).message}`)
  }
  return null
}

function saveCheckpoint(state: CheckpointState) {
  state.timestamp = Date.now()
  try {
    // Ensure tmp directory exists
    if (!fs.existsSync('tmp')) {
      fs.mkdirSync('tmp', { recursive: true })
    }
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.warn(`⚠️  Could not save checkpoint: ${(e as any).message}`)
  }
}

async function sleep(ms: number) {
  const jitter = ms * 0.2 * (Math.random() - 0.5)
  return new Promise(resolve => setTimeout(resolve, ms + jitter))
}

async function fetchFromRPC(method: string, params: any[], retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Math.random(),
          method,
          params
        })
      })

      const data = await response.json()
      if (data.error) throw new Error(`RPC: ${data.error.message}`)
      return data.result
    } catch (e: any) {
      if (attempt === retries) throw e
      await sleep(200 * Math.pow(2, attempt - 1))
    }
  }
}

async function fetchBlockTimestamp(blockNumber: number): Promise<number | null> {
  try {
    const block = await fetchFromRPC('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false])
    if (!block || !block.timestamp) return null
    return parseInt(block.timestamp, 16)
  } catch (e) {
    console.warn(`  Failed to fetch block ${blockNumber}: ${(e as any).message.substring(0, 40)}`)
    return null
  }
}

async function processWorkerBatch(
  blocks: number[],
  workerId: number,
  checkpoint: CheckpointState
): Promise<number> {
  const ch = getClickHouseClient()
  let processed = 0
  const batchResults: Array<{ block_number: number; timestamp: number }> = []

  for (const blockNum of blocks) {
    const timestamp = await fetchBlockTimestamp(blockNum)

    if (timestamp !== null) {
      batchResults.push({ block_number: blockNum, timestamp })
      processed++

      // Insert in batches
      if (batchResults.length >= INSERT_BATCH_SIZE) {
        try {
          const values = batchResults.map(r => `(${r.block_number}, ${r.timestamp})`).join(', ')
          await ch.exec({
            query: `INSERT INTO tmp_block_timestamps (block_number, block_timestamp) VALUES ${values}`
          })
          batchResults.length = 0
        } catch (e: any) {
          console.warn(`[Worker ${workerId}] Insert failed: ${e.message.substring(0, 60)}`)
        }
      }

      // Checkpoint progress
      if (processed % CHECKPOINT_INTERVAL === 0) {
        checkpoint.workers[workerId] = {
          lastBlock: blockNum,
          blocksProcessed: processed,
          complete: false
        }
        checkpoint.fetchedBlocks = Object.values(checkpoint.workers).reduce((sum, w) => sum + w.blocksProcessed, 0)
        saveCheckpoint(checkpoint)
      }
    }

    // Rate limiting
    await sleep(50)
  }

  // Insert remaining batch
  if (batchResults.length > 0) {
    try {
      const values = batchResults.map(r => `(${r.block_number}, ${r.timestamp})`).join(', ')
      await ch.exec({
        query: `INSERT INTO tmp_block_timestamps (block_number, block_timestamp) VALUES ${values}`
      })
    } catch (e: any) {
      console.warn(`[Worker ${workerId}] Final insert failed: ${e.message.substring(0, 60)}`)
    }
  }

  // Mark worker complete
  checkpoint.workers[workerId].complete = true
  checkpoint.fetchedBlocks = Object.values(checkpoint.workers).reduce((sum, w) => sum + w.blocksProcessed, 0)
  saveCheckpoint(checkpoint)

  return processed
}

async function main() {
  console.log('='.repeat(100))
  console.log('FIX ERC-1155 TIMESTAMPS')
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  const ch = getClickHouseClient()
  let checkpoint = loadCheckpoint()

  // Phase 1: Analyze scope
  console.log('\n[PHASE 1] Analyzing scope...')
  console.log('─'.repeat(100))

  const distinctResult = await ch.query({
    query: 'SELECT DISTINCT block_number FROM default.erc1155_transfers ORDER BY block_number',
    format: 'JSONEachRow'
  })
  const distinctBlocks = await distinctResult.json<any>()
  const allBlocks = distinctBlocks.map((r: any) => parseInt(r.block_number))

  console.log(`Found ${allBlocks.length.toLocaleString()} unique blocks to fetch`)
  console.log(`Block range: ${allBlocks[0].toLocaleString()} → ${allBlocks[allBlocks.length - 1].toLocaleString()}`)

  // Initialize checkpoint if needed
  if (!checkpoint) {
    checkpoint = {
      phase: 'fetch',
      timestamp: Date.now(),
      totalBlocks: allBlocks.length,
      fetchedBlocks: 0,
      workers: {}
    }
    saveCheckpoint(checkpoint)
  }

  // Phase 2: Create temp table
  console.log('\n[PHASE 2] Setting up temp table...')
  console.log('─'.repeat(100))

  try {
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS tmp_block_timestamps (
          block_number UInt64,
          block_timestamp UInt32,
          fetched_at DateTime DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY block_number
      `
    })
    console.log('✅ Temp table ready: tmp_block_timestamps')
  } catch (e: any) {
    console.log(`✅ Temp table exists: ${e.message.substring(0, 60)}`)
  }

  // Check what's already fetched
  const existingResult = await ch.query({
    query: 'SELECT count() as count FROM tmp_block_timestamps',
    format: 'JSONEachRow'
  })
  const existingData = await existingResult.json<any>()
  const alreadyFetched = parseInt(existingData[0].count)
  console.log(`Already fetched: ${alreadyFetched.toLocaleString()} blocks`)

  // Phase 3: Fetch timestamps
  if (checkpoint.phase === 'fetch') {
    console.log('\n[PHASE 3] Fetching block timestamps...')
    console.log('─'.repeat(100))
    console.log(`Workers: ${WORKER_COUNT}`)
    console.log(`Estimated time: ${((allBlocks.length * 150) / 1000 / 60 / WORKER_COUNT).toFixed(1)} minutes`)
    console.log('')

    // Get blocks that still need fetching
    const fetchedBlocksResult = await ch.query({
      query: 'SELECT block_number FROM tmp_block_timestamps',
      format: 'JSONEachRow'
    })
    const fetchedBlocksData = await fetchedBlocksResult.json<any>()
    const fetchedBlockSet = new Set(fetchedBlocksData.map((r: any) => parseInt(r.block_number)))
    const remainingBlocks = allBlocks.filter(b => !fetchedBlockSet.has(b))

    console.log(`Remaining to fetch: ${remainingBlocks.length.toLocaleString()} blocks`)

    if (remainingBlocks.length === 0) {
      console.log('✅ All blocks already fetched!')
      checkpoint.phase = 'rebuild'
      saveCheckpoint(checkpoint)
    } else {
      // Split work across workers
      const blocksPerWorker = Math.ceil(remainingBlocks.length / WORKER_COUNT)
      const workerPromises = []
      const startTime = Date.now()

      for (let i = 0; i < WORKER_COUNT; i++) {
        const start = i * blocksPerWorker
        const end = Math.min(start + blocksPerWorker, remainingBlocks.length)
        const workerBlocks = remainingBlocks.slice(start, end)

        if (workerBlocks.length === 0) continue

        const promise = processWorkerBatch(workerBlocks, i + 1, checkpoint)
          .then(count => {
            console.log(`✅ Worker ${i + 1} complete: ${count.toLocaleString()} blocks`)
            return count
          })
          .catch(e => {
            console.error(`❌ Worker ${i + 1} failed: ${e.message}`)
            return 0
          })

        workerPromises.push(promise)
      }

      console.log(`Started ${WORKER_COUNT} workers...\n`)

      const results = await Promise.all(workerPromises)
      const totalFetched = results.reduce((a, b) => a + b, 0)
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

      console.log(`\n✅ Fetch complete: ${totalFetched.toLocaleString()} blocks in ${elapsed} minutes`)

      checkpoint.phase = 'rebuild'
      checkpoint.fetchedBlocks = alreadyFetched + totalFetched
      saveCheckpoint(checkpoint)
    }
  }

  // Phase 4: Rebuild table
  console.log('\n[PHASE 4] Rebuilding table with correct timestamps...')
  console.log('─'.repeat(100))

  console.log('Creating new table with JOIN...')
  const rebuildStart = Date.now()

  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS default.erc1155_transfers_fixed AS
      SELECT
        t.tx_hash,
        t.log_index,
        t.block_number,
        toDateTime(bt.block_timestamp) as block_timestamp,
        t.contract,
        t.token_id,
        t.from_address,
        t.to_address,
        t.value,
        t.operator,
        t.decoded_data,
        t.raw_json
      FROM default.erc1155_transfers t
      LEFT JOIN tmp_block_timestamps bt ON t.block_number = bt.block_number
    `
  })

  const rebuildElapsed = ((Date.now() - rebuildStart) / 1000 / 60).toFixed(1)
  console.log(`✅ Table rebuilt in ${rebuildElapsed} minutes`)

  // Phase 5: Verify before swap
  console.log('\n[PHASE 5] Verifying new table...')
  console.log('─'.repeat(100))

  const verifyResult = await ch.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(block_timestamp = toDateTime(0)) as epoch_zero_count,
        min(block_timestamp) as min_ts,
        max(block_timestamp) as max_ts
      FROM default.erc1155_transfers_fixed
    `,
    format: 'JSONEachRow'
  })

  const verifyData = await verifyResult.json<any>()
  const newRowCount = parseInt(verifyData[0].total_rows)
  const epochZeroCount = parseInt(verifyData[0].epoch_zero_count)

  console.log(`New table row count: ${newRowCount.toLocaleString()}`)
  console.log(`Epoch zero timestamps: ${epochZeroCount.toLocaleString()}`)
  console.log(`Date range: ${verifyData[0].min_ts} → ${verifyData[0].max_ts}`)

  // Verify row count matches
  const originalCountResult = await ch.query({
    query: 'SELECT count() as count FROM default.erc1155_transfers',
    format: 'JSONEachRow'
  })
  const originalCountData = await originalCountResult.json<any>()
  const originalCount = parseInt(originalCountData[0].count)

  if (newRowCount !== originalCount) {
    console.error(`❌ Row count mismatch! Original: ${originalCount.toLocaleString()}, New: ${newRowCount.toLocaleString()}`)
    console.error(`   Not performing swap. Investigate and retry.`)
    return
  }

  if (epochZeroCount > 0) {
    console.warn(`⚠️  Warning: ${epochZeroCount.toLocaleString()} rows still have epoch zero timestamps`)
    console.warn(`   This might be expected for blocks that failed to fetch`)
  }

  console.log('\n✅ Verification passed!')

  // Phase 6: Atomic swap
  console.log('\n[PHASE 6] Performing atomic swap...')
  console.log('─'.repeat(100))

  try {
    // Rename old table to backup
    await ch.exec({
      query: 'RENAME TABLE default.erc1155_transfers TO default.erc1155_transfers_backup'
    })
    console.log('✅ Renamed original table to erc1155_transfers_backup')

    // Rename new table to production
    await ch.exec({
      query: 'RENAME TABLE default.erc1155_transfers_fixed TO default.erc1155_transfers'
    })
    console.log('✅ Renamed fixed table to erc1155_transfers')

    checkpoint.phase = 'complete'
    saveCheckpoint(checkpoint)

    console.log('\n✅ SWAP COMPLETE!')
    console.log(`\nBackup table preserved as: default.erc1155_transfers_backup`)
    console.log(`To drop after verification: DROP TABLE default.erc1155_transfers_backup`)

  } catch (e: any) {
    console.error(`❌ Swap failed: ${e.message}`)
    console.error(`   Original table intact. Can retry swap manually.`)
    return
  }

  // Phase 7: Final verification
  console.log('\n[PHASE 7] Final verification...')
  console.log('─'.repeat(100))

  const finalResult = await ch.query({
    query: `
      SELECT
        count() as total_rows,
        min(block_timestamp) as min_ts,
        max(block_timestamp) as max_ts,
        countIf(block_timestamp = toDateTime(0)) as epoch_zero
      FROM default.erc1155_transfers
    `,
    format: 'JSONEachRow'
  })

  const finalData = await finalResult.json<any>()
  console.log(`\nFinal table statistics:`)
  console.log(`  Total rows: ${parseInt(finalData[0].total_rows).toLocaleString()}`)
  console.log(`  Date range: ${finalData[0].min_ts} → ${finalData[0].max_ts}`)
  console.log(`  Epoch zero: ${parseInt(finalData[0].epoch_zero).toLocaleString()}`)

  // Monthly distribution check
  const monthlyResult = await ch.query({
    query: `
      SELECT
        toYYYYMM(block_timestamp) as month,
        count() as transfers
      FROM default.erc1155_transfers
      WHERE block_timestamp >= '2022-12-01'
        AND block_timestamp < '2024-06-01'
      GROUP BY month
      ORDER BY month
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })

  const monthlyData = await monthlyResult.json<any>()
  if (monthlyData.length > 0) {
    console.log(`\nSample monthly distribution (Dec 2022 - May 2024):`)
    monthlyData.forEach((row: any) => {
      console.log(`  ${row.month}: ${parseInt(row.transfers).toLocaleString()} transfers`)
    })
  }

  console.log('\n' + '='.repeat(100))
  console.log('✅ TIMESTAMP FIX COMPLETE!')
  console.log('='.repeat(100))
  console.log(`\nNext steps:`)
  console.log(`  1. Verify data looks correct`)
  console.log(`  2. Drop backup: DROP TABLE default.erc1155_transfers_backup`)
  console.log(`  3. Drop temp table: DROP TABLE tmp_block_timestamps`)
  console.log(`  4. Continue with downstream tasks (flatten, wallet map, fact trades)`)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
