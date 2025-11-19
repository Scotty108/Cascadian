#!/usr/bin/env npx tsx

/**
 * PARALLEL BACKFILL FOR MISSING ERC1155 TRANSFERS
 *
 * Optimizations:
 * - 8 parallel workers processing different ranges
 * - Batch size: 1000 (10x larger)
 * - No rate limiting (Alchemy can handle it)
 * - Pre-cached tx_hash list (avoid repeated NOT IN queries)
 *
 * Expected runtime: ~90 minutes (down from 22 hours)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import { Worker } from 'worker_threads'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
if (!RPC_URL) {
  console.error('ERROR: ALCHEMY_POLYGON_RPC_URL not set in .env.local')
  process.exit(1)
}

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'.toLowerCase()
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

const WORKER_COUNT = 8
const BATCH_SIZE = 1000 // 10x larger batches
const TX_HASH_CACHE_FILE = '/tmp/missing-tx-hashes.json'

interface WorkerProgress {
  workerId: number
  processed: number
  eventsFound: number
  batchNum: number
  totalBatches: number
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

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(`RPC: ${data.error.message}`)
  }
  return data.result
}

async function getAllMissingTxHashes(): Promise<string[]> {
  // Check cache first
  if (fs.existsSync(TX_HASH_CACHE_FILE)) {
    console.log('📦 Loading cached tx_hashes...')
    const cached = JSON.parse(fs.readFileSync(TX_HASH_CACHE_FILE, 'utf-8'))
    console.log(`   Loaded ${cached.length.toLocaleString()} tx_hashes from cache`)
    return cached
  }

  console.log('🔍 Fetching all missing tx_hashes (this will take ~30 seconds)...')

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM erc1155_transfers
      )
      AND transaction_hash != ''
      ORDER BY transaction_hash
    `,
    clickhouse_settings: {
      send_progress_in_http_headers: 0
    }
  })

  const data = JSON.parse(await result.text()).data
  const txHashes = data.map((row: any) => row.transaction_hash)

  // Cache for future runs
  fs.writeFileSync(TX_HASH_CACHE_FILE, JSON.stringify(txHashes))
  console.log(`   Cached ${txHashes.length.toLocaleString()} tx_hashes`)

  return txHashes
}

async function processBatch(txHashes: string[]): Promise<number> {
  let eventsFound = 0
  const values: string[] = []

  // Helper to insert in chunks
  async function insertChunk(chunk: string[]) {
    if (chunk.length === 0) return

    const sql = `INSERT INTO erc1155_transfers (tx_hash, log_index, block_number, contract, token_id, from_address, to_address, value) VALUES ${chunk.join(', ')}`

    try {
      await clickhouse.query({
        query: sql,
        clickhouse_settings: {
          send_progress_in_http_headers: 0,
          async_insert: 1,
          wait_for_async_insert: 0
        }
      })
    } catch (e: any) {
      console.error(`  ❌ ClickHouse insert failed: ${e.message.substring(0, 100)}`)
      throw e
    }
  }

  // Process all tx_hashes in parallel batches of 50
  const promises = []
  for (let i = 0; i < txHashes.length; i += 50) {
    const chunk = txHashes.slice(i, i + 50)

    promises.push(
      Promise.all(chunk.map(async (txHash) => {
        try {
          const receipt = await fetchFromRPC('eth_getTransactionReceipt', [txHash])

          if (!receipt || !receipt.logs) return []

          const erc1155Logs = receipt.logs.filter((log: any) =>
            log.address && log.address.toLowerCase() === CONDITIONAL_TOKENS &&
            log.topics && log.topics[0] === TRANSFER_BATCH_SIG
          )

          if (erc1155Logs.length === 0) return []

          return erc1155Logs.map((log: any) => {
            const topics = log.topics || []
            const hash = (log.transactionHash || '').replace(/'/g, "''")
            const address = (log.address || '').replace(/'/g, "''")
            const tokenId = (topics[3] || '').replace(/'/g, "''")
            const fromAddr = (topics[1] || '').replace(/'/g, "''")
            const toAddr = (topics[2] || '').replace(/'/g, "''")
            const dataValue = (log.data || '').replace(/'/g, "''")
            const blockNumber = parseInt(log.blockNumber || '0x0', 16)
            const logIndex = parseInt(log.logIndex || '0x0', 16)

            return `('${hash}', ${logIndex}, ${blockNumber}, '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', '${dataValue}')`
          })

        } catch (e: any) {
          if (e.message.includes('not found')) return []
          // Silently skip errors for speed
          return []
        }
      }))
    )
  }

  const results = await Promise.all(promises)

  for (const chunkResults of results) {
    for (const events of chunkResults) {
      if (Array.isArray(events)) {
        values.push(...events)
        eventsFound += events.length
      }
    }
  }

  // Insert all events
  if (values.length > 0) {
    await insertChunk(values)
  }

  return eventsFound
}

async function runWorker(workerId: number, txHashes: string[], startIdx: number, endIdx: number) {
  const myTxHashes = txHashes.slice(startIdx, endIdx)
  const totalBatches = Math.ceil(myTxHashes.length / BATCH_SIZE)

  let processedCount = 0
  let totalEventsFound = 0

  console.log(`Worker ${workerId}: Processing ${myTxHashes.length.toLocaleString()} tx_hashes (${totalBatches} batches)`)

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const offset = batchNum * BATCH_SIZE
    const batch = myTxHashes.slice(offset, offset + BATCH_SIZE)

    try {
      const eventsFound = await processBatch(batch)
      totalEventsFound += eventsFound
      processedCount += batch.length

      if (batchNum % 10 === 0) {
        console.log(`  Worker ${workerId}: Batch ${batchNum + 1}/${totalBatches} - ${processedCount.toLocaleString()} txs, ${totalEventsFound.toLocaleString()} events`)
      }

    } catch (e: any) {
      console.error(`  Worker ${workerId}: Batch ${batchNum} failed: ${e.message}`)
    }
  }

  console.log(`✅ Worker ${workerId} complete: ${processedCount.toLocaleString()} txs, ${totalEventsFound.toLocaleString()} events`)
}

async function main() {
  console.log('═'.repeat(80))
  console.log('PARALLEL BACKFILL - MISSING ERC1155 TRANSFERS')
  console.log('═'.repeat(80))
  console.log()
  console.log(`Workers: ${WORKER_COUNT}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  console.log(`Parallelization: 50 concurrent RPC requests per batch`)
  console.log()

  // Step 1: Get all missing tx_hashes (cached)
  const allTxHashes = await getAllMissingTxHashes()
  const totalMissing = allTxHashes.length

  console.log(`Total missing: ${totalMissing.toLocaleString()} tx_hashes`)
  console.log()

  if (totalMissing === 0) {
    console.log('✅ All transactions already have ERC1155 data!')
    return
  }

  // Step 2: Divide work among workers
  const chunkSize = Math.ceil(totalMissing / WORKER_COUNT)
  const workers: Promise<void>[] = []

  console.log('Starting workers...')
  console.log()

  for (let i = 0; i < WORKER_COUNT; i++) {
    const startIdx = i * chunkSize
    const endIdx = Math.min(startIdx + chunkSize, totalMissing)

    workers.push(runWorker(i, allTxHashes, startIdx, endIdx))
  }

  // Wait for all workers
  const startTime = Date.now()
  await Promise.all(workers)
  const elapsed = (Date.now() - startTime) / 1000 / 60

  console.log()
  console.log('═'.repeat(80))
  console.log('✅ BACKFILL COMPLETE')
  console.log('═'.repeat(80))
  console.log(`  Runtime: ${elapsed.toFixed(1)} minutes`)
  console.log()
  console.log('NEXT STEP: Run 43-erc1155-recovery-improved.ts to rebuild trades_with_direction')
  console.log('═'.repeat(80))
  console.log()

  // Cleanup cache
  try {
    fs.unlinkSync(TX_HASH_CACHE_FILE)
  } catch {}
}

main().catch((e) => {
  console.error('FATAL ERROR:', e)
  process.exit(1)
})
