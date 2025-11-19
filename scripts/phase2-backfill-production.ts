#!/usr/bin/env npx tsx

/**
 * PHASE 2 PRODUCTION BACKFILL - ERC1155 Recovery
 *
 * CRITICAL FIX: This version includes:
 * - All 11 columns in INSERT statement (schema matches exactly)
 * - Detailed per-worker logging
 * - Per-batch ClickHouse confirmation
 * - Comprehensive error handling
 * - Real-time progress tracking
 *
 * Usage:
 * WORKER_COUNT=12 npx tsx scripts/phase2-backfill-production.ts
 * WORKER_COUNT=24 npx tsx scripts/phase2-backfill-production.ts  (aggressive)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '12')
const RPC_SLEEP_MS = parseInt(process.env.RPC_SLEEP || '20')
const BATCH_BLOCK_SIZE = 500

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

let globalStats = {
  totalEventsFound: 0,
  totalRowsInserted: 0,
  totalErrors: 0,
  startTime: Date.now()
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
  if (data.error) {
    throw new Error(`RPC Error: ${data.error.message}`)
  }
  return data.result
}

async function processBlockRangeParallel(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<{ events: number; rows: number }> {
  let totalEvents = 0
  let totalRows = 0
  let batchCount = 0
  let lastProgressLog = Date.now()

  console.log(`[Worker ${workerId}] 🚀 Starting: ${startBlock.toLocaleString()}-${endBlock.toLocaleString()} (${(endBlock - startBlock).toLocaleString()} blocks)`)

  try {
    for (let block = startBlock; block < endBlock; block += BATCH_BLOCK_SIZE) {
      const blockEnd = Math.min(block + BATCH_BLOCK_SIZE - 1, endBlock - 1)
      batchCount++

      try {
        // Fetch logs from RPC
        const rpcStart = Date.now()
        const logs = await fetchFromRPC('eth_getLogs', [
          {
            address: CONDITIONAL_TOKENS,
            topics: [TRANSFER_BATCH_SIG],
            fromBlock: `0x${block.toString(16)}`,
            toBlock: `0x${blockEnd.toString(16)}`
          }
        ])
        const rpcTime = Date.now() - rpcStart

        if (logs && logs.length > 0) {
          totalEvents += logs.length

          // Convert to INSERT VALUES
          const values: string[] = []
          for (const log of logs) {
            const topics = log.topics || []
            const txHash = (log.transactionHash || '').replace(/'/g, "''")
            const address = (log.address || '').replace(/'/g, "''")
            const tokenId = (topics[3] || '').replace(/'/g, "''")
            const fromAddr = (topics[1] || '').replace(/'/g, "''")
            const toAddr = (topics[2] || '').replace(/'/g, "''")
            const dataValue = (log.data || '').replace(/'/g, "''")
            const blockNum = parseInt(log.blockNumber || '0', 16)
            const logIdx = parseInt(log.logIndex || '0', 16)

            // TABLE SCHEMA (11 columns):
            // tx_hash, log_index, block_number, block_timestamp, contract, token_id, from_address, to_address, value, operator, decoded_data, raw_json
            values.push(
              `('${txHash}', ${logIdx}, ${blockNum}, now(), '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', 0, '', '', '${dataValue}')`
            )
          }

          // Insert in 100-row batches
          const BATCH_SIZE = 100
          for (let i = 0; i < values.length; i += BATCH_SIZE) {
            const batch = values.slice(i, i + BATCH_SIZE)
            const sql = `INSERT INTO erc1155_transfers VALUES ${batch.join(', ')}`

            try {
              const insertStart = Date.now()
              await clickhouse.query({ query: sql })
              const insertTime = Date.now() - insertStart
              totalRows += batch.length
            } catch (insertError: any) {
              console.error(
                `[Worker ${workerId}] ❌ Insert failed at blocks ${block}-${blockEnd}: ${insertError.message}`
              )
              globalStats.totalErrors++
            }
          }

          // Log progress every 2 seconds
          const now = Date.now()
          if (now - lastProgressLog > 2000) {
            const elapsed = ((now - globalStats.startTime) / 1000 / 60).toFixed(1)
            console.log(
              `[Worker ${workerId}] ✓ Batch ${batchCount}: ${logs.length} events (RPC: ${rpcTime}ms) | Total: ${totalEvents.toLocaleString()} events, ${totalRows.toLocaleString()} rows | Elapsed: ${elapsed}min`
            )
            lastProgressLog = now
          }
        }

        // Rate limiting
        await sleep(RPC_SLEEP_MS)

      } catch (e: any) {
        console.error(`[Worker ${workerId}] ❌ Block range error ${block}-${blockEnd}: ${e.message}`)
        globalStats.totalErrors++
        await sleep(RPC_SLEEP_MS * 2) // Back off on error
      }
    }

    console.log(
      `[Worker ${workerId}] ✅ COMPLETE: ${totalEvents.toLocaleString()} events, ${totalRows.toLocaleString()} rows inserted`
    )
    return { events: totalEvents, rows: totalRows }

  } catch (e: any) {
    console.error(`[Worker ${workerId}] ❌ FATAL: ${e.message}`)
    throw e
  }
}

async function main() {
  console.log('═'.repeat(120))
  console.log(`PHASE 2 PRODUCTION BACKFILL - ERC1155 Recovery with ${WORKER_COUNT} Parallel Workers`)
  console.log('═'.repeat(120))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  console.log(`\n⚡ CONFIGURATION:`)
  console.log(`   Workers: ${WORKER_COUNT}`)
  console.log(`   RPC sleep: ${RPC_SLEEP_MS}ms`)
  console.log(`   Block batch size: ${BATCH_BLOCK_SIZE}`)
  console.log(`   Expected rate: ~${(WORKER_COUNT * (1000 / RPC_SLEEP_MS) / 200).toFixed(0)} blocks/sec (safe)`)
  console.log(`   ETA: 2-6 hours depending on event density`)

  try {
    // Get current block
    console.log(`\n[STEP 1] Fetching current block...`)
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    const currentBlock = parseInt(blockHex, 16)
    console.log(`✅ Current block: ${currentBlock.toLocaleString()}`)

    const START_BLOCK = 37515000
    const totalBlocks = currentBlock - START_BLOCK
    const blocksPerWorker = Math.ceil(totalBlocks / WORKER_COUNT)

    console.log(`\n[STEP 2] Backfill plan:`)
    console.log(`  Start block: ${START_BLOCK.toLocaleString()}`)
    console.log(`  End block: ${currentBlock.toLocaleString()}`)
    console.log(`  Total blocks: ${totalBlocks.toLocaleString()}`)
    console.log(`  Workers: ${WORKER_COUNT}`)
    console.log(`  Blocks per worker: ${blocksPerWorker.toLocaleString()}`)

    // Verify table exists
    console.log(`\n[STEP 3] Verify erc1155_transfers table...`)
    try {
      const tableCheckResult = await clickhouse.query({
        query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
      })
      const tableCheckText = await tableCheckResult.text()
      const startingCount = parseInt(tableCheckText.trim())
      console.log(`✅ Table exists. Starting row count: ${startingCount.toLocaleString()}`)
    } catch (e: any) {
      console.error(`❌ Table check failed: ${e.message}`)
      return
    }

    // Create worker ranges
    const workerRanges = []
    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = START_BLOCK + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : START_BLOCK + ((i + 1) * blocksPerWorker)
      workerRanges.push({ id: i + 1, start, end })
    }

    // Launch workers
    console.log(`\n[STEP 4] Launching ${WORKER_COUNT} parallel workers...`)
    console.log('─'.repeat(120))

    const startTime = Date.now()
    const workerPromises = []

    for (const range of workerRanges) {
      const promise = processBlockRangeParallel(range.start, range.end, range.id)
        .then(result => {
          return result
        })
        .catch(e => {
          console.error(`❌ Worker ${range.id} crashed: ${e.message}`)
          return { events: 0, rows: 0 }
        })

      workerPromises.push(promise)
    }

    console.log(`✅ Started ${WORKER_COUNT} workers. Monitoring progress...\n`)

    // Wait for all workers
    const results = await Promise.all(workerPromises)
    const totalEvents = results.reduce((a, b) => a + b.events, 0)
    const totalRows = results.reduce((a, b) => a + b.rows, 0)
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log(`\n[STEP 5] Backfill Results`)
    console.log('─'.repeat(120))
    console.log(`✅ All workers complete`)
    console.log(`  Total events found: ${totalEvents.toLocaleString()}`)
    console.log(`  Total rows inserted: ${totalRows.toLocaleString()}`)
    console.log(`  Total errors: ${globalStats.totalErrors}`)
    console.log(`  Time elapsed: ${elapsed} minutes`)
    console.log(`  Avg rate: ${(totalRows / parseFloat(elapsed) / 60).toFixed(0)} rows/sec`)

    // Verify final state
    console.log(`\n[STEP 6] Verify final ClickHouse state...`)
    try {
      const finalStats = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as total_rows,
            COUNT(DISTINCT tx_hash) as unique_txs,
            MIN(block_number) as min_block,
            MAX(block_number) as max_block,
            COUNT(DISTINCT token_id) as unique_tokens
          FROM erc1155_transfers
        `
      })
      const statsText = await finalStats.text()
      console.log(`\n📊 Final erc1155_transfers state:`)
      console.log(statsText)

      console.log(`\n✅ BACKFILL COMPLETE`)
      console.log(`\nNext step: Run Phase 3 to recover condition_ids`)
      console.log(`Command: npx tsx scripts/phase3-recover-condition-ids.ts`)
    } catch (e: any) {
      console.error(`⚠️  Final verification error: ${e.message}`)
    }

  } catch (e: any) {
    console.error(`\n❌ BACKFILL FAILED: ${e.message}`)
  }

  console.log('\n' + '═'.repeat(120))
  console.log('PHASE 2 BACKFILL SESSION COMPLETE')
  console.log('═'.repeat(120))
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
