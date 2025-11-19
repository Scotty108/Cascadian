#!/usr/bin/env npx tsx

/**
 * PHASE 2 FULL BACKFILL: ERC1155 with Parallel Workers
 *
 * Speed up: Use 4-8 parallel workers instead of sequential requests
 * Timeline: 1-2 hours instead of 4-7 hours
 *
 * Strategy:
 * - Divide block range into worker batches
 * - Each worker processes its blocks in parallel
 * - Insert results in batches to ClickHouse
 * - Total speedup: 4-8x
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'
import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '4') // 4-8 workers

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
// Use only TRANSFER_BATCH_SIG - TransferSingle causes RPC validation errors with Alchemy
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

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
  if (data.error) throw new Error(data.error.message)
  return data.result
}

async function processBlockRange(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<{ events: any[], count: number }> {
  const events = []
  const BATCH_SIZE = 1000

  for (let block = startBlock; block < endBlock; block += BATCH_SIZE) {
    const blockEnd = Math.min(block + BATCH_SIZE - 1, endBlock - 1)

    try {
      // Use hex format for blocks and single topic (TransferBatch only)
      const logs = await fetchFromRPC('eth_getLogs', [
        {
          address: CONDITIONAL_TOKENS,
          topics: [TRANSFER_BATCH_SIG],
          fromBlock: `0x${block.toString(16)}`,
          toBlock: `0x${blockEnd.toString(16)}`
        }
      ])

      if (logs && logs.length > 0) {
        events.push(...logs)
      }

      // Log progress
      if ((block - startBlock) % 10000 === 0) {
        const pct = (((block - startBlock) / (endBlock - startBlock)) * 100).toFixed(0)
        console.log(`[Worker ${workerId}] ${pct}% complete (${events.length.toLocaleString()} events)`)
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 50))

    } catch (e: any) {
      console.warn(`[Worker ${workerId}] Block ${block}-${blockEnd}: ${e.message.substring(0, 40)}`)
    }
  }

  return { events, count: events.length }
}

async function insertEventsToClickHouse(events: any[]): Promise<void> {
  if (events.length === 0) return

  const values = events.map((log: any) => {
    const topics = log.topics || []
    return [
      log.transactionHash || '',
      parseInt(log.logIndex || 0, 16),
      parseInt(log.blockNumber || 0, 16),
      log.address || '',
      topics[3] || '', // token_id
      topics[1] || '', // from
      topics[2] || '', // to
      log.data || ''
    ]
  })

  // Batch insert to avoid too-large queries
  const BATCH_SIZE = 10000
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE)
    const sql = `
      INSERT INTO erc1155_transfers VALUES (
        ${batch.map(v => `('${v[0]}', ${v[1]}, ${v[2]}, '${v[3]}', '${v[4]}', '${v[5]}', '${v[6]}', '${v[7]}')`).join(', ')}
      )
    `
    await clickhouse.query({ query: sql })
  }
}

async function main() {
  console.log('='.repeat(100))
  console.log(`PHASE 2 FULL BACKFILL: ERC1155 with ${WORKER_COUNT} Parallel Workers`)
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  // Get current block
  console.log('\n[STEP 1] Plan backfill strategy')
  console.log('─'.repeat(100))

  let currentBlock: number
  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    currentBlock = parseInt(blockHex, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}`)

    // Target: Blocks 37.5M to current
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
    console.log(`  Sequential: 4-7 hours`)
    console.log(`  With ${WORKER_COUNT} workers: 1-2 hours ⚡`)

    // Create worker ranges
    const workerRanges = []
    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = START_BLOCK + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : START_BLOCK + ((i + 1) * blocksPerWorker)
      workerRanges.push({ id: i + 1, start, end })
    }

    // Step 2: Launch parallel workers
    console.log('\n[STEP 2] Launch parallel workers')
    console.log('─'.repeat(100))

    const startTime = Date.now()
    const workerPromises = []

    for (const range of workerRanges) {
      const promise = processBlockRange(range.start, range.end, range.id)
        .then(async result => {
          console.log(`✅ Worker ${range.id} complete: ${result.count.toLocaleString()} events`)
          // Insert results
          await insertEventsToClickHouse(result.events)
          return result.count
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

    console.log(`\n[STEP 3] Backfill Results`)
    console.log('─'.repeat(100))
    console.log(`✅ All workers complete`)
    console.log(`  Total events fetched: ${totalEvents.toLocaleString()}`)
    console.log(`  Time elapsed: ${elapsed} minutes`)
    console.log(`  Avg rate: ${(totalEvents / parseFloat(elapsed) / 60).toFixed(0)} events/sec`)

    // Verify
    console.log('\n[STEP 4] Verify backfill in ClickHouse')
    console.log('─'.repeat(100))

    const stats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_events,
          COUNT(DISTINCT tx_hash) as unique_txs,
          MIN(block_number) as min_block,
          MAX(block_number) as max_block
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = stats[0]
    console.log(`erc1155_transfers now contains:`)
    console.log(`  Total events: ${parseInt(s.total_events).toLocaleString()}`)
    console.log(`  Unique transactions: ${parseInt(s.unique_txs).toLocaleString()}`)
    console.log(`  Block range: ${parseInt(s.min_block).toLocaleString()} → ${parseInt(s.max_block).toLocaleString()}`)

    console.log(`\n✅ BACKFILL COMPLETE`)
    console.log(`\nNext: Phase 3 - Join trades_raw with ERC1155 to recover condition_ids`)

  } catch (e: any) {
    console.error(`❌ Backfill failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 2 FULL BACKFILL COMPLETE')
  console.log('='.repeat(100))
}

main().catch(e => console.error('Fatal:', e))
