#!/usr/bin/env npx tsx

/**
 * BACKFILL MISSING ERC1155 TRANSFERS BY TX_HASH
 *
 * Strategy:
 * 1. Get all unique tx_hashes from trades_raw (32.4M)
 * 2. Exclude tx_hashes we already have in erc1155_transfers (126K)
 * 3. Fetch transaction receipts for the missing 32.3M tx_hashes
 * 4. Extract ERC1155 TransferBatch events
 * 5. Insert into erc1155_transfers
 *
 * Expected runtime: 18-27 hours for 32M transactions
 * RPC calls needed: 32M (1 per transaction)
 * Cost estimate: $0 with Alchemy free tier (300M compute units/month)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
if (!RPC_URL) {
  console.error('ERROR: ALCHEMY_POLYGON_RPC_URL not set in .env.local')
  process.exit(1)
}

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'.toLowerCase()
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '8')
const BATCH_SIZE = 100 // Process 100 tx_hashes at a time
const CHECKPOINT_FILE = '/tmp/erc1155-txhash-backfill-checkpoint.json'

interface CheckpointState {
  timestamp: number
  processedCount: number
  lastTxHash: string
}

function loadCheckpoint(): CheckpointState {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      const checkpoint = JSON.parse(data)
      console.log(`\n📋 Resuming from checkpoint: ${checkpoint.processedCount.toLocaleString()} tx_hashes processed`)
      return checkpoint
    }
  } catch (e) {
    console.warn(`⚠️  Could not load checkpoint: ${(e as any).message}`)
  }
  return { timestamp: Date.now(), processedCount: 0, lastTxHash: '' }
}

function saveCheckpoint(state: CheckpointState) {
  state.timestamp = Date.now()
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2))
  } catch (e) {
    console.warn(`⚠️  Could not save checkpoint: ${(e as any).message}`)
  }
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

async function getMissingTxHashes(offset: number, limit: number): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT transaction_hash
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM erc1155_transfers
      )
      AND transaction_hash != ''
      ORDER BY transaction_hash
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    clickhouse_settings: {
      send_progress_in_http_headers: 0
    }
  })

  const data = JSON.parse(await result.text()).data
  return data.map((row: any) => row.transaction_hash)
}

async function processBatch(txHashes: string[]): Promise<number> {
  let eventsFound = 0
  const values: string[] = []

  // Helper function to insert values in chunks - disable progress headers
  async function insertChunk(chunk: string[]) {
    if (chunk.length === 0) return

    const sql = `INSERT INTO erc1155_transfers (tx_hash, log_index, block_number, contract, token_id, from_address, to_address, value) VALUES ${chunk.join(', ')}`

    try {
      // Disable progress headers to avoid overflow
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
      throw e // Re-throw to trigger batch retry
    }
  }

  for (const txHash of txHashes) {
    try {
      const receipt = await fetchFromRPC('eth_getTransactionReceipt', [txHash])

      if (!receipt || !receipt.logs) continue

      // Find ERC1155 TransferBatch events
      const erc1155Logs = receipt.logs.filter((log: any) =>
        log.address && log.address.toLowerCase() === CONDITIONAL_TOKENS &&
        log.topics && log.topics[0] === TRANSFER_BATCH_SIG
      )

      if (erc1155Logs.length === 0) continue

      for (const log of erc1155Logs) {
        const topics = log.topics || []
        const hash = (log.transactionHash || '').replace(/'/g, "''")
        const address = (log.address || '').replace(/'/g, "''")
        const tokenId = (topics[3] || '').replace(/'/g, "''")
        const fromAddr = (topics[1] || '').replace(/'/g, "''")
        const toAddr = (topics[2] || '').replace(/'/g, "''")
        const dataValue = (log.data || '').replace(/'/g, "''")
        const blockNumber = parseInt(log.blockNumber || '0x0', 16)
        const logIndex = parseInt(log.logIndex || '0x0', 16)

        values.push(
          `('${hash}', ${logIndex}, ${blockNumber}, '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', '${dataValue}')`
        )
        eventsFound++
      }

      // Rate limiting: 10ms per request = 100 req/sec
      await new Promise(resolve => setTimeout(resolve, 10))

    } catch (e: any) {
      // Skip failed transactions (might be reverted or too old)
      if (e.message.includes('not found')) continue
      console.warn(`  ⚠️  Error fetching ${txHash.substring(0, 10)}: ${e.message.substring(0, 50)}`)
    }
  }

  // Insert remaining values
  if (values.length > 0) {
    await insertChunk(values)
  }

  return eventsFound
}

async function main() {
  console.log('═'.repeat(80))
  console.log('BACKFILL MISSING ERC1155 TRANSFERS BY TX_HASH')
  console.log('═'.repeat(80))
  console.log()

  // Step 1: Count missing tx_hashes
  console.log('Step 1: Counting missing transaction hashes...')

  const countResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT transaction_hash) as missing_count
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM erc1155_transfers
      )
      AND transaction_hash != ''
    `,
    clickhouse_settings: {
      send_progress_in_http_headers: 0
    }
  })

  const countData = JSON.parse(await countResult.text()).data[0]
  const totalMissing = parseInt(countData.missing_count)

  console.log(`  Total missing tx_hashes: ${totalMissing.toLocaleString()}`)
  console.log()

  if (totalMissing === 0) {
    console.log('✅ All transactions already have ERC1155 data!')
    return
  }

  // Step 2: Estimate runtime
  const estimatedHours = (totalMissing / 100) * 10 / 1000 / 3600 // 10ms per tx @ 100/sec
  console.log(`Estimated runtime: ~${estimatedHours.toFixed(1)} hours`)
  console.log(`Processing ${BATCH_SIZE} tx_hashes per batch`)
  console.log()

  // Step 3: Load checkpoint
  const checkpoint = loadCheckpoint()
  let processedCount = checkpoint.processedCount
  let totalEventsFound = 0

  console.log('Step 2: Processing transaction receipts...')
  console.log()

  const totalBatches = Math.ceil(totalMissing / BATCH_SIZE)
  let batchNum = Math.floor(processedCount / BATCH_SIZE)

  while (batchNum < totalBatches) {
    const offset = batchNum * BATCH_SIZE

    process.stdout.write(`  Batch ${batchNum + 1}/${totalBatches} (${offset.toLocaleString()}): `)

    try {
      // Get next batch of missing tx_hashes
      const txHashes = await getMissingTxHashes(offset, BATCH_SIZE)

      if (txHashes.length === 0) {
        console.log('Done (no more missing tx_hashes)')
        break
      }

      // Process this batch
      const eventsFound = await processBatch(txHashes)
      totalEventsFound += eventsFound
      processedCount += txHashes.length

      console.log(`✓ ${txHashes.length} txs, ${eventsFound} events found`)

      // Save checkpoint every 10 batches
      if (batchNum % 10 === 0) {
        checkpoint.processedCount = processedCount
        checkpoint.lastTxHash = txHashes[txHashes.length - 1]
        saveCheckpoint(checkpoint)
      }

      batchNum++

    } catch (e: any) {
      console.log(`\n  ❌ Batch failed: ${e.message}`)
      // Save checkpoint and exit on critical error
      checkpoint.processedCount = processedCount
      saveCheckpoint(checkpoint)
      throw e
    }
  }

  console.log()
  console.log('═'.repeat(80))
  console.log('✅ BACKFILL COMPLETE')
  console.log('═'.repeat(80))
  console.log(`  Processed: ${processedCount.toLocaleString()} transactions`)
  console.log(`  Events found: ${totalEventsFound.toLocaleString()}`)
  console.log()
  console.log('NEXT STEP: Run 43-erc1155-recovery-improved.ts to rebuild trades_with_direction')
  console.log('═'.repeat(80))
  console.log()

  // Cleanup checkpoint
  try {
    fs.unlinkSync(CHECKPOINT_FILE)
  } catch {}
}

main().catch((e) => {
  console.error('FATAL ERROR:', e)
  process.exit(1)
})
