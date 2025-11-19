#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '8')
const RPC_SLEEP_MS = parseInt(process.env.RPC_SLEEP || '50')
const BATCH_BLOCK_SIZE = 500 // Smaller batches for faster feedback

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[], workerId: number): Promise<any> {
  const start = Date.now()
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
    const elapsed = Date.now() - start

    if (data.error) {
      console.log(`[Worker ${workerId}] RPC error (${elapsed}ms): ${data.error.message}`)
      return null
    }

    return { result: data.result, elapsed }
  } catch (e: any) {
    const elapsed = Date.now() - start
    console.log(`[Worker ${workerId}] Fetch error (${elapsed}ms): ${e.message}`)
    return null
  }
}

async function processBlockRangeParallel(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<number> {
  let totalEvents = 0
  let batchCount = 0

  console.log(`[Worker ${workerId}] Starting: blocks ${startBlock.toLocaleString()} - ${endBlock.toLocaleString()}`)

  for (let block = startBlock; block < endBlock; block += BATCH_BLOCK_SIZE) {
    const blockEnd = Math.min(block + BATCH_BLOCK_SIZE - 1, endBlock - 1)
    batchCount++

    const rpcResult = await fetchFromRPC('eth_getLogs', [
      {
        address: CONDITIONAL_TOKENS,
        topics: [TRANSFER_BATCH_SIG],
        fromBlock: `0x${block.toString(16)}`,
        toBlock: `0x${blockEnd.toString(16)}`
      }
    ], workerId)

    if (!rpcResult) {
      console.log(`[Worker ${workerId}] RPC failed at batch ${batchCount}`)
      continue
    }

    const logs = rpcResult.result || []
    const elapsed = rpcResult.elapsed

    if (logs.length > 0) {
      totalEvents += logs.length

      // Insert immediately
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
          console.warn(`[Worker ${workerId}] Insert error: ${insertError.message.substring(0, 40)}`)
        }
      }

      if (batchCount % 10 === 0) {
        console.log(`[Worker ${workerId}] Batch ${batchCount}: ${logs.length} events (RPC: ${elapsed}ms, total: ${totalEvents.toLocaleString()})`)
      }
    }

    await sleep(RPC_SLEEP_MS)
  }

  console.log(`[Worker ${workerId}] Complete: ${totalEvents.toLocaleString()} events`)
  return totalEvents
}

async function main() {
  console.log('═'.repeat(100))
  console.log(`PHASE 2 BACKFILL WITH DETAILED LOGGING (${WORKER_COUNT} workers)`)
  console.log('═'.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  console.log(`\n⚡ CONFIG:`)
  console.log(`   Workers: ${WORKER_COUNT}`)
  console.log(`   RPC sleep: ${RPC_SLEEP_MS}ms`)
  console.log(`   Batch size: ${BATCH_BLOCK_SIZE} blocks`)

  try {
    // Get current block
    console.log(`\n[SETUP] Fetching current block...`)
    const blockHexResult = await fetchFromRPC('eth_blockNumber', [], 0)
    if (!blockHexResult) {
      console.error('Failed to get current block')
      return
    }

    const currentBlock = parseInt(blockHexResult.result, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}\n`)

    const START_BLOCK = 37515000
    const totalBlocks = currentBlock - START_BLOCK
    const blocksPerWorker = Math.ceil(totalBlocks / WORKER_COUNT)

    console.log(`[SETUP] Backfill plan:`)
    console.log(`   Total blocks: ${totalBlocks.toLocaleString()}`)
    console.log(`   Blocks per worker: ${blocksPerWorker.toLocaleString()}`)

    // Launch workers
    console.log(`\n[STEP 2] Launching ${WORKER_COUNT} workers...`)
    const startTime = Date.now()
    const workerPromises = []

    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = START_BLOCK + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : START_BLOCK + ((i + 1) * blocksPerWorker)

      const promise = processBlockRangeParallel(start, end, i + 1)
        .then(count => {
          console.log(`✅ Worker ${i + 1} done: ${count.toLocaleString()} events`)
          return count
        })
        .catch(e => {
          console.error(`❌ Worker ${i + 1} crashed: ${e.message}`)
          return 0
        })

      workerPromises.push(promise)
    }

    // Wait for all workers
    console.log(`Waiting for workers...\n`)
    const results = await Promise.all(workerPromises)
    const totalEvents = results.reduce((a, b) => a + b, 0)
    const elapsedMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log(`\n${'═'.repeat(100)}`)
    console.log(`✅ COMPLETE`)
    console.log(`   Total events: ${totalEvents.toLocaleString()}`)
    console.log(`   Time elapsed: ${elapsedMin} minutes`)
    console.log(`═`.repeat(100))

  } catch (e: any) {
    console.error('Fatal error:', e.message)
  }
}

main()
