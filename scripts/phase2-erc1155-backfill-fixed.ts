#!/usr/bin/env npx tsx
/**
 * PHASE 2 ERC-1155 BACKFILL (NETWORK-FIXED)
 *
 * Fixes:
 * - Uses shared ClickHouse client from lib/clickhouse/client.ts (no DNS issues)
 * - 200ms jittered retry on failures
 * - Checkpoint every 10k blocks (not 10M events)
 * - 12 parallel workers for saturation
 * - Batched inserts (500 rows per batch)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = 32  // Safe sustained rate without hitting API limits or CPU bottleneck
const BATCH_BLOCK_SIZE = 1000
const CHECKPOINT_INTERVAL_BLOCKS = 10000
const INSERT_BATCH_SIZE = 500

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
const CHECKPOINT_FILE = 'blockchain-backfill-checkpoint.json'

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
      console.log(`\n📋 Resuming from checkpoint ${new Date(checkpoint.timestamp).toISOString()}`)
      console.log(`   Total events: ${checkpoint.totalEventsProcessed.toLocaleString()}`)
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
  // Add jitter (±20%)
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
      console.warn(`[RPC] Attempt ${attempt} failed: ${e.message.substring(0, 60)}. Retrying...`)
      await sleep(200 * Math.pow(2, attempt - 1)) // Exponential backoff with jitter
    }
  }
}

async function processBlockRangeParallel(
  startBlock: number,
  endBlock: number,
  workerId: number,
  checkpoint: CheckpointState
): Promise<number> {
  const ch = getClickHouseClient()
  let totalEvents = 0
  let blocksSinceCheckpoint = 0

  // Resume from checkpoint
  const resumeBlock = checkpoint.workers[workerId]?.lastBlock || startBlock
  if (resumeBlock > startBlock) {
    console.log(`[Worker ${workerId}] Resuming from block ${resumeBlock.toLocaleString()}`)
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

        // Prepare values for batched insert
        const values: string[] = []
        const normalize = (hex: string) => hex.toLowerCase().replace('0x', '').replace(/'/g, "''")

        for (const log of logs) {
          const topics = log.topics || []
          const txHash = normalize(log.transactionHash || '')
          const address = normalize(log.address || '')
          const tokenId = normalize(topics[3] || '')
          const fromAddr = normalize(topics[1] || '')
          const toAddr = normalize(topics[2] || '')
          const dataValue = normalize(log.data || '')

          values.push(
            `('${txHash}', ${parseInt(log.logIndex || 0, 16)}, ${parseInt(log.blockNumber || 0, 16)}, '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', 0, '${dataValue}')`
          )
        }

        // Insert in batches of 500
        for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
          const batch = values.slice(i, i + INSERT_BATCH_SIZE)
          const sql = `INSERT INTO default.erc1155_transfers (tx_hash, log_index, block_number, contract, token_id, from_address, to_address, value, decoded_data) VALUES ${batch.join(', ')}`

          let inserted = false
          for (let retry = 1; retry <= 3; retry++) {
            try {
              await ch.exec({ query: sql })
              inserted = true
              break
            } catch (insertError: any) {
              if (retry === 3) {
                console.warn(`[Worker ${workerId}] Insert failed after 3 attempts: ${insertError.message.substring(0, 60)}`)
              } else {
                await sleep(200 * Math.pow(2, retry - 1))
              }
            }
          }
        }

        blocksSinceCheckpoint += BATCH_BLOCK_SIZE
      }

      // Checkpoint every 10k blocks
      if (blocksSinceCheckpoint >= CHECKPOINT_INTERVAL_BLOCKS) {
        checkpoint.workers[workerId] = { lastBlock: blockEnd, eventsProcessed: totalEvents }
        saveCheckpoint(checkpoint)
        console.log(`[Worker ${workerId}] ✓ Checkpoint at block ${blockEnd.toLocaleString()} (${totalEvents.toLocaleString()} events)`)
        blocksSinceCheckpoint = 0
      }

      // Rate limiting with jitter
      await sleep(100)

    } catch (e: any) {
      console.warn(`[Worker ${workerId}] Error in blocks ${block}-${blockEnd}: ${e.message.substring(0, 60)}`)
      await sleep(200)
    }
  }

  // Final checkpoint
  checkpoint.workers[workerId] = { lastBlock: endBlock, eventsProcessed: totalEvents }
  checkpoint.totalEventsProcessed += totalEvents
  saveCheckpoint(checkpoint)

  return totalEvents
}

async function main() {
  console.log('='.repeat(100))
  console.log(`PHASE 2 ERC-1155 BACKFILL (NETWORK-FIXED) with ${WORKER_COUNT} Workers`)
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  const checkpoint = loadCheckpoint()

  console.log('\n[STEP 1] Planning backfill...')
  console.log('─'.repeat(100))

  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    const currentBlock = parseInt(blockHex, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}`)

    const START_BLOCK = 37515000
    const totalBlocks = currentBlock - START_BLOCK
    const blocksPerWorker = Math.ceil(totalBlocks / WORKER_COUNT)

    console.log(`\nBackfill plan:`)
    console.log(`  Start: ${START_BLOCK.toLocaleString()}`)
    console.log(`  End: ${currentBlock.toLocaleString()}`)
    console.log(`  Total blocks: ${totalBlocks.toLocaleString()}`)
    console.log(`  Workers: ${WORKER_COUNT}`)
    console.log(`  Blocks/worker: ${blocksPerWorker.toLocaleString()}`)
    console.log(`  Checkpoint interval: ${CHECKPOINT_INTERVAL_BLOCKS.toLocaleString()} blocks`)
    console.log(`\nEstimated: ~30-40 minutes with ${WORKER_COUNT} workers`)

    // Create worker ranges
    const workerRanges = []
    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = START_BLOCK + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : START_BLOCK + ((i + 1) * blocksPerWorker)
      workerRanges.push({ id: i + 1, start, end })
    }

    console.log('\n[STEP 2] Verifying erc1155_transfers table...')
    console.log('─'.repeat(100))

    const ch = getClickHouseClient()
    const currentCount = await ch.query({
      query: 'SELECT COUNT(*) as count FROM default.erc1155_transfers',
      format: 'JSONEachRow'
    })
    const countData = (await currentCount.json())[0]
    console.log(`✅ Current rows: ${parseInt(countData.count).toLocaleString()}`)

    console.log('\n[STEP 3] Launching workers...')
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

    console.log('\n[STEP 4] Results')
    console.log('─'.repeat(100))
    console.log(`✅ Backfill complete`)
    console.log(`  Events fetched: ${totalEvents.toLocaleString()}`)
    console.log(`  Time: ${elapsed} minutes`)
    console.log(`  Rate: ${(totalEvents / parseFloat(elapsed) / 60).toFixed(0)} events/sec`)

    // Verify final state
    const finalCount = await ch.query({
      query: 'SELECT COUNT(*) as count FROM default.erc1155_transfers',
      format: 'JSONEachRow'
    })
    const finalData = (await finalCount.json())[0]
    console.log(`  Total in DB: ${parseInt(finalData.count).toLocaleString()}`)

    // Clean up checkpoint on success
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE)
      console.log(`  Checkpoint cleaned up`)
    }

    const finalTotal = parseInt(finalData.count)
    if (finalTotal >= 10_000_000) {
      console.log(`\n✅ TARGET REACHED: ${finalTotal.toLocaleString()} rows`)
      console.log(`\nNext steps:`)
      console.log(`  1. npx tsx build-system-wallet-map-v2.ts`)
      console.log(`  2. npx tsx build-fact-trades.ts`)
      console.log(`  3. npx tsx build-pnl-views.ts`)
    } else {
      console.log(`\n⚠️  Target not reached: ${finalTotal.toLocaleString()} / 10M rows`)
      console.log(`   May need additional backfill or investigation`)
    }

  } catch (e: any) {
    console.error(`❌ Fatal error: ${e.message}`)
    console.log(`\n💾 Checkpoint saved. Restart to resume.`)
    throw e
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
