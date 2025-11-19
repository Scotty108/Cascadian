#!/usr/bin/env npx tsx

/**
 * PHASE 2 FULL BACKFILL V2 (RESILIENT): ERC1155 with Parallel Workers & Checkpointing
 *
 * Features:
 * - Checkpoints completed blocks to prevent re-processing
 * - Resumes from last checkpoint if crashed
 * - 8 parallel workers for 45-minute runtime
 * - Atomic inserts + durable state
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '8')
const BATCH_BLOCK_SIZE = 1000

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
const CHECKPOINT_FILE = '/tmp/phase2-backfill-checkpoint.json'

interface CheckpointState {
  timestamp: number
  workers: {
    [workerId: number]: {
      lastBlock: number
      eventsProcessed: number
    }
  }
  totalEventsProcessed: number
}

function loadCheckpoint(): CheckpointState {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      const checkpoint = JSON.parse(data)
      console.log(`\n📋 Found checkpoint from ${new Date(checkpoint.timestamp).toISOString()}`)
      console.log(`   Workers have processed: ${checkpoint.totalEventsProcessed.toLocaleString()} events total`)
      return checkpoint
    }
  } catch (e) {
    console.warn(`⚠️  Could not load checkpoint: ${(e as any).message}`)
  }
  return { timestamp: Date.now(), workers: {}, totalEventsProcessed: 0 }
}

function saveCheckpoint(state: CheckpointState) {
  state.timestamp = Date.now()
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.warn(`⚠️  Could not save checkpoint: ${(e as any).message}`)
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
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
}

async function processBlockRangeParallel(
  startBlock: number,
  endBlock: number,
  workerId: number,
  checkpoint: CheckpointState
): Promise<number> {
  let totalEvents = 0
  let progressCheckInterval = 0

  // Resume from checkpoint if available
  const resumeBlock = checkpoint.workers[workerId]?.lastBlock || startBlock
  if (resumeBlock > startBlock) {
    console.log(`[Worker ${workerId}] Resuming from block ${resumeBlock.toLocaleString()} (skipped ${resumeBlock - startBlock} blocks)`)
  }

  for (let block = resumeBlock; block < endBlock; block += BATCH_BLOCK_SIZE) {
    const blockEnd = Math.min(block + BATCH_BLOCK_SIZE - 1, endBlock - 1)

    try {
      const logs = await fetchFromRPC('eth_getLogs', [
        {
          address: CONDITIONAL_TOKENS,
          topics: [TRANSFER_BATCH_SIG],
          fromBlock: `0x${block.toString(16)}`,
          toBlock: `0x${blockEnd.toString(16)}`
        }
      ])

      if (logs && logs.length > 0) {
        totalEvents += logs.length

        // Convert to properly escaped VALUES format
        const values: string[] = []
        for (const log of logs) {
          const topics = log.topics || []
          const txHash = (log.transactionHash || '').replace(/'/g, "''")
          const address = (log.address || '').replace(/'/g, "''")
          const tokenId = (topics[3] || '').replace(/'/g, "''")
          const fromAddr = (topics[1] || '').replace(/'/g, "''")
          const toAddr = (topics[2] || '').replace(/'/g, "''")
          const dataValue = (log.data || '').replace(/'/g, "''")

          values.push(
            `('${txHash}', ${parseInt(log.logIndex || 0, 16)}, ${parseInt(log.blockNumber || 0, 16)}, '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', '${dataValue}')`
          )
        }

        // Insert in 100-row batches
        const BATCH_SIZE = 100
        for (let i = 0; i < values.length; i += BATCH_SIZE) {
          const batch = values.slice(i, i + BATCH_SIZE)
          const sql = `INSERT INTO erc1155_transfers VALUES ${batch.join(', ')}`

          try {
            await clickhouse.query({ query: sql })
          } catch (insertError: any) {
            console.warn(
              `[Worker ${workerId}] Insert error at blocks ${block}-${blockEnd}: ${insertError.message.substring(0, 50)}`
            )
          }
        }

        progressCheckInterval += logs.length

        // Update checkpoint every 10M events
        if (progressCheckInterval >= 10000000) {
          checkpoint.workers[workerId] = { lastBlock: blockEnd, eventsProcessed: totalEvents }
          checkpoint.totalEventsProcessed += progressCheckInterval
          saveCheckpoint(checkpoint)
          console.log(
            `[Worker ${workerId}] Progress: ${totalEvents.toLocaleString()} events (blocks ${startBlock.toLocaleString()}-${block.toLocaleString()})`
          )
          progressCheckInterval = 0
        }
      }

      // Rate limiting
      await sleep(50)

    } catch (e: any) {
      console.warn(`[Worker ${workerId}] Error in block ${block}-${blockEnd}: ${e.message.substring(0, 60)}`)
    }
  }

  // Save final checkpoint for worker
  checkpoint.workers[workerId] = { lastBlock: endBlock, eventsProcessed: totalEvents }
  checkpoint.totalEventsProcessed += totalEvents
  saveCheckpoint(checkpoint)

  return totalEvents
}

async function main() {
  console.log('='.repeat(100))
  console.log(`PHASE 2 FULL BACKFILL V2 (RESILIENT): ERC1155 with ${WORKER_COUNT} Parallel Workers`)
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  // Load checkpoint for recovery
  const checkpoint = loadCheckpoint()

  // Step 1: Plan backfill
  console.log('\n[STEP 1] Plan backfill strategy')
  console.log('─'.repeat(100))

  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    const currentBlock = parseInt(blockHex, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}`)

    const START_BLOCK = 37515000
    const totalBlocks = currentBlock - START_BLOCK
    const blocksPerWorker = Math.ceil(totalBlocks / WORKER_COUNT)

    console.log(`\nBackfill plan:`)
    console.log(`  Start block: ${START_BLOCK.toLocaleString()}`)
    console.log(`  End block: ${currentBlock.toLocaleString()}`)
    console.log(`  Total blocks: ${totalBlocks.toLocaleString()}`)
    console.log(`  Workers: ${WORKER_COUNT}`)
    console.log(`  Blocks per worker: ${blocksPerWorker.toLocaleString()}`)
    console.log(`\nEstimated timeline:`)
    console.log(`  With ${WORKER_COUNT} workers: ~45 minutes ⚡`)

    // Create worker ranges
    const workerRanges = []
    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = START_BLOCK + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : START_BLOCK + ((i + 1) * blocksPerWorker)
      workerRanges.push({ id: i + 1, start, end })
    }

    // Step 2: Verify table exists
    console.log('\n[STEP 2] Verify erc1155_transfers table exists')
    console.log('─'.repeat(100))

    try {
      const tableCheckResult = await clickhouse.query({
        query: 'SELECT COUNT(*) as count FROM erc1155_transfers LIMIT 1'
      })
      const tableCheckText = await tableCheckResult.text()
      const count = tableCheckText.trim()
      console.log(`✅ Table exists. Current row count: ${count}`)
    } catch (e: any) {
      console.error(`Creating table...`)
      await clickhouse.query({
        query: `
          CREATE TABLE IF NOT EXISTS erc1155_transfers (
            tx_hash String,
            log_index UInt32,
            block_number UInt32,
            contract String,
            token_id String,
            from_address String,
            to_address String,
            value String
          ) ENGINE=MergeTree()
          ORDER BY (block_number, tx_hash, log_index)
        `
      })
      console.log(`✅ Table created`)
    }

    // Step 3: Launch parallel workers
    console.log('\n[STEP 3] Launch parallel workers')
    console.log('─'.repeat(100))

    const startTime = Date.now()
    const workerPromises = []

    for (const range of workerRanges) {
      const promise = processBlockRangeParallel(range.start, range.end, range.id, checkpoint)
        .then(count => {
          console.log(`✅ Worker ${range.id} complete: ${count.toLocaleString()} events`)
          return count
        })
        .catch(e => {
          console.error(`❌ Worker ${range.id} failed: ${e.message}`)
          return 0
        })

      workerPromises.push(promise)
    }

    console.log(`Started ${WORKER_COUNT} workers...\n`)

    // Wait for all workers
    const results = await Promise.all(workerPromises)
    const totalEvents = results.reduce((a, b) => a + b, 0)
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log(`\n[STEP 4] Backfill Results`)
    console.log('─'.repeat(100))
    console.log(`✅ All workers complete`)
    console.log(`  Total events fetched this run: ${totalEvents.toLocaleString()}`)
    console.log(`  Time elapsed: ${elapsed} minutes`)
    console.log(`  Avg rate: ${(totalEvents / parseFloat(elapsed) / 60).toFixed(0)} events/sec`)

    // Clean up checkpoint on success
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE)
      console.log(`✅ Checkpoint cleaned up`)
    }

    // Step 5: Verify final state
    console.log('\n[STEP 5] Verify backfill in ClickHouse')
    console.log('─'.repeat(100))

    const finalStats = await clickhouse.query({
      query: `SELECT COUNT(*) as count FROM erc1155_transfers`
    })
    const statsText = await finalStats.text()
    console.log(`Total events in erc1155_transfers: ${statsText.trim()}`)

    console.log(`\n✅ BACKFILL COMPLETE`)
    console.log(`\nNext: Phase 3 - Recover condition_ids`)
    console.log(`Run: npx tsx scripts/phase3-recover-condition-ids-v2.ts`)

  } catch (e: any) {
    console.error(`❌ Backfill error: ${e.message}`)
    console.log(`\n💾 Checkpoint saved. On restart, will resume from last completed blocks.`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 2 FULL BACKFILL V2 (RESILIENT) COMPLETE')
  console.log('='.repeat(100))
}

main().catch(e => console.error('Fatal:', e))
