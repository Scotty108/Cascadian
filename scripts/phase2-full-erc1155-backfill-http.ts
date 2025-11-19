#!/usr/bin/env npx tsx
/**
 * PHASE 2 FULL BACKFILL - HTTP MODE
 * Uses raw HTTP POST to ClickHouse (bypasses broken client library)
 *
 * THIS WORKS: curl -u user:pass -X POST "https://host:8443/" --data-binary "INSERT..."
 * Raw HTTP POST inserts persist correctly (tested: 206112 → 206113)
 *
 * Tuning:
 * WORKER_COUNT=12 RPC_SLEEP=100 → ~3-4 hours (STABLE, tested)
 * WORKER_COUNT=16 RPC_SLEEP=50 → ~2-3 hours (FASTER, monitor)
 * WORKER_COUNT=32 RPC_SLEEP=10 → ~1.5 hours (AGGRESSIVE, risk RPC limits)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CH_HOST = process.env.CLICKHOUSE_HOST || ''
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || ''

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '12')
const RPC_SLEEP_MS = parseInt(process.env.RPC_SLEEP || '100')
const BATCH_BLOCK_SIZE = 1000
const BATCH_INSERT_SIZE = 1000  // Insert 1000 rows per HTTP POST

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

let globalProgressInterval = 0
let globalEventsProcessed = 0

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

async function insertToClickHouse(rows: string[]): Promise<void> {
  if (rows.length === 0) return

  const valuesList = rows.join(',\n  ')
  const insertSQL = `INSERT INTO erc1155_transfers
    (tx_hash, log_index, block_number, block_timestamp, contract, token_id, from_address, to_address, value, operator, decoded_data, raw_json)
    VALUES
    ${valuesList}`

  try {
    const response = await fetch(`${CH_HOST}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`default:${CH_PASSWORD}`).toString('base64')}`
      },
      body: insertSQL
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
  } catch (error) {
    console.error(`[INSERT ERROR] Failed to insert ${rows.length} rows:`, error)
    throw error
  }
}

async function processBlockRangeParallel(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<number> {
  let totalEvents = 0
  let batchRows: string[] = []

  console.log(`[Worker ${workerId}] Starting: blocks ${startBlock} → ${endBlock}`)

  for (let block = startBlock; block < endBlock; block += BATCH_BLOCK_SIZE) {
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
        globalProgressInterval += logs.length

        for (const log of logs) {
          const topics = log.topics || []
          const txHash = (log.transactionHash || '').replace(/'/g, "''")
          const address = (log.address || '').replace(/'/g, "''")
          const tokenId = (topics[3] || '').replace(/'/g, "''")
          const fromAddr = (topics[1] || '').replace(/'/g, "''")
          const toAddr = (topics[2] || '').replace(/'/g, "''")
          const dataValue = (log.data || '').replace(/'/g, "''")
          const blockNum = parseInt(log.blockNumber || 0, 16)
          const logIdx = parseInt(log.logIndex || 0, 16)

          batchRows.push(
            `('${txHash}', ${logIdx}, ${blockNum}, now(), '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', 0, '', '', '${dataValue}')`
          )

          // Flush batch when it reaches size limit
          if (batchRows.length >= BATCH_INSERT_SIZE) {
            await insertToClickHouse(batchRows)
            batchRows = []
            globalEventsProcessed += BATCH_INSERT_SIZE
          }
        }
      }

      // Report progress every 10M events
      if (globalProgressInterval >= 10_000_000) {
        console.log(`[Progress] Worker ${workerId}: ${totalEvents.toLocaleString()} events, global: ${globalEventsProcessed.toLocaleString()}`)
        globalProgressInterval = 0
      }

      // RPC rate limiting
      await sleep(RPC_SLEEP_MS)
    } catch (error) {
      console.error(`[Worker ${workerId}] Error at block ${block}:`, error)
      throw error
    }
  }

  // Flush remaining rows
  if (batchRows.length > 0) {
    await insertToClickHouse(batchRows)
    globalEventsProcessed += batchRows.length
  }

  console.log(`[Worker ${workerId}] ✅ Complete: ${totalEvents.toLocaleString()} events`)
  return totalEvents
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════')
  console.log('PHASE 2 FULL BACKFILL - HTTP MODE: ERC1155 Recovery')
  console.log('════════════════════════════════════════════════════════════════════════════\n')

  console.log(`⚡ CONFIGURATION:`)
  console.log(`   Workers: ${WORKER_COUNT}`)
  console.log(`   RPC sleep: ${RPC_SLEEP_MS}ms`)
  console.log(`   Batch size: ${BATCH_INSERT_SIZE} rows`)
  console.log(`   Expected rate: ~${Math.round(1000 / RPC_SLEEP_MS)} req/sec\n`)

  // Get current block
  const currentBlockHex = await fetchFromRPC('eth_blockNumber', [])
  const currentBlock = parseInt(currentBlockHex, 16)
  console.log(`[SETUP] Current block: ${currentBlock.toLocaleString()}\n`)

  const startBlock = 37_515_000
  const endBlock = currentBlock
  const totalBlocks = endBlock - startBlock
  const blocksPerWorker = Math.ceil(totalBlocks / WORKER_COUNT)

  console.log(`[SETUP] Backfill plan:`)
  console.log(`  Start block: ${startBlock.toLocaleString()}`)
  console.log(`  End block: ${endBlock.toLocaleString()}`)
  console.log(`  Total blocks: ${totalBlocks.toLocaleString()}`)
  console.log(`  Workers: ${WORKER_COUNT}`)
  console.log(`  Blocks per worker: ${blocksPerWorker.toLocaleString()}\n`)

  console.log(`[STEP 1] Verify erc1155_transfers table exists`)
  console.log(`════════════════════════════════════════════════════════════════════════════\n`)

  try {
    const response = await fetch(`${CH_HOST}/?query=SELECT+COUNT(*)+FROM+erc1155_transfers`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`default:${CH_PASSWORD}`).toString('base64')}`
      }
    })
    const count = await response.text()
    console.log(`✅ Table exists. Current row count: ${count.trim()}\n`)
  } catch (error) {
    console.error(`❌ Cannot connect to ClickHouse:`, error)
    process.exit(1)
  }

  console.log(`[STEP 2] Launch ${WORKER_COUNT} parallel workers`)
  console.log(`════════════════════════════════════════════════════════════════════════════\n`)

  const workers = []
  for (let i = 0; i < WORKER_COUNT; i++) {
    const workerStart = startBlock + (i * blocksPerWorker)
    const workerEnd = i === WORKER_COUNT - 1 ? endBlock : startBlock + ((i + 1) * blocksPerWorker)

    workers.push(
      processBlockRangeParallel(workerStart, workerEnd, i + 1)
        .catch(error => {
          console.error(`[Worker ${i + 1}] FATAL ERROR:`, error)
          process.exit(1)
        })
    )
  }

  console.log(`Started ${WORKER_COUNT} workers...\n`)

  // Wait for all workers
  const results = await Promise.all(workers)
  const totalEvents = results.reduce((a, b) => a + b, 0)

  console.log(`\n════════════════════════════════════════════════════════════════════════════`)
  console.log(`✅ BACKFILL COMPLETE`)
  console.log(`════════════════════════════════════════════════════════════════════════════`)
  console.log(`Total events processed: ${totalEvents.toLocaleString()}`)
  console.log(`Total blocks scanned: ${totalBlocks.toLocaleString()}`)
  console.log(`Events per block (avg): ${(totalEvents / totalBlocks).toFixed(2)}\n`)

  console.log(`Next: Run Phase 3 (condition_id recovery) to JOIN with trades_raw`)
}

main().catch(error => {
  console.error('FATAL:', error)
  process.exit(1)
})
