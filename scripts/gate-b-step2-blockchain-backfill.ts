#!/usr/bin/env npx tsx

/**
 * GATE B RECOVERY - STEP 2: Blockchain Backfill Worker
 *
 * Fetches missing ERC-1155 transfer events from Polygon blockchain via Alchemy RPC.
 * Targets only the missing condition IDs identified in _still_missing_cids.
 *
 * Features:
 * - 8-16 parallel workers for optimal performance
 * - Checkpointing for crash recovery
 * - Both TransferSingle and TransferBatch event types
 * - Automatic CID computation from token_id
 * - Streaming inserts to repair_pairs_temp
 * - Exponential backoff on RPC errors
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '16')
const BLOCKS_PER_SHARD = 100000 // 100k block shards as specified
const CHECKPOINT_FILE = '/tmp/gate-b-backfill-checkpoint.json'

// ERC1155 Event Signatures
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

interface CheckpointState {
  timestamp: number
  workers: {
    [workerId: number]: {
      lastBlock: number
      pairsFound: number
    }
  }
  totalPairsFound: number
}

interface RepairPair {
  tx_hash: string
  cid: string
}

// Global cache for missing CIDs (load once, reuse)
let missingCidsCache: Set<string> | null = null

function loadCheckpoint(): CheckpointState {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8')
      const checkpoint = JSON.parse(data)
      console.log(`\n📋 Resuming from checkpoint: ${checkpoint.totalPairsFound.toLocaleString()} pairs already found`)
      return checkpoint
    }
  } catch (e) {
    console.warn(`⚠️  Could not load checkpoint: ${(e as any).message}`)
  }
  return { timestamp: Date.now(), workers: {}, totalPairsFound: 0 }
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      if (data.error) {
        throw new Error(`RPC: ${data.error.message}`)
      }
      return data.result
    } catch (e: any) {
      if (attempt === retries) {
        throw e
      }
      // Exponential backoff: 2^attempt seconds
      const backoffMs = Math.pow(2, attempt) * 1000
      console.warn(`[Retry ${attempt}/${retries}] ${e.message}, waiting ${backoffMs}ms...`)
      await sleep(backoffMs)
    }
  }
}

/**
 * Compute condition_id from token_id
 * Formula: cid = '0x' + leftPad(hex(token_id / 256), 64)
 */
function computeCidFromTokenId(tokenIdHex: string): string {
  try {
    // Remove 0x prefix if present
    const cleanHex = tokenIdHex.replace('0x', '')

    // Convert to BigInt
    const tokenIdBigInt = BigInt('0x' + cleanHex)

    // Divide by 256
    const collectionId = tokenIdBigInt / BigInt(256)

    // Convert back to hex and pad to 64 chars
    const cidHex = collectionId.toString(16).padStart(64, '0')

    return '0x' + cidHex
  } catch (e) {
    console.warn(`Failed to compute CID from token_id ${tokenIdHex}:`, e)
    return ''
  }
}

async function loadMissingCids(): Promise<Set<string>> {
  if (missingCidsCache) {
    return missingCidsCache
  }

  console.log('Loading missing CIDs from ClickHouse...')
  const result = await clickhouse.query({
    query: 'SELECT cid FROM _still_missing_cids',
    format: 'JSONEachRow'
  })

  const rows = await result.json<{ cid: string }>()
  missingCidsCache = new Set(rows.map(r => r.cid.toLowerCase()))
  console.log(`✅ Loaded ${missingCidsCache.size.toLocaleString()} missing CIDs into memory`)
  return missingCidsCache
}

async function insertRepairPairs(pairs: RepairPair[]) {
  if (pairs.length === 0) return

  const values = pairs.map(p =>
    `('${p.tx_hash.replace(/'/g, "''")}', '${p.cid.replace(/'/g, "''")}')`
  )

  const query = `INSERT INTO repair_pairs_temp (tx_hash, cid) VALUES ${values.join(', ')}`

  await clickhouse.command({ query })
}

async function processBlockRange(
  addresses: string[],
  startBlock: number,
  endBlock: number,
  workerId: number,
  checkpoint: CheckpointState
): Promise<number> {
  let totalPairs = 0
  const missingCids = await loadMissingCids()

  // Resume from checkpoint if available
  const resumeBlock = checkpoint.workers[workerId]?.lastBlock || startBlock
  if (resumeBlock > startBlock) {
    console.log(`[Worker ${workerId}] Resuming from block ${resumeBlock.toLocaleString()}`)
  }

  for (let block = resumeBlock; block < endBlock; block += BLOCKS_PER_SHARD) {
    const blockEnd = Math.min(block + BLOCKS_PER_SHARD - 1, endBlock - 1)

    for (const address of addresses) {
      try {
        // Fetch TransferSingle events
        const singleLogs = await fetchFromRPC('eth_getLogs', [
          {
            address: address,
            topics: [TRANSFER_SINGLE],
            fromBlock: `0x${block.toString(16)}`,
            toBlock: `0x${blockEnd.toString(16)}`
          }
        ])

        // Fetch TransferBatch events
        const batchLogs = await fetchFromRPC('eth_getLogs', [
          {
            address: address,
            topics: [TRANSFER_BATCH],
            fromBlock: `0x${block.toString(16)}`,
            toBlock: `0x${blockEnd.toString(16)}`
          }
        ])

        const allLogs = [...(singleLogs || []), ...(batchLogs || [])]

        if (allLogs.length > 0) {
          const pairs: RepairPair[] = []

          for (const log of allLogs) {
            const txHash = log.transactionHash
            if (!txHash) continue

            // For TransferSingle: topics[3] is token_id
            // For TransferBatch: topics[3] is first token_id (good enough for condition_id)
            const tokenIdHex = log.topics[3]
            if (!tokenIdHex) continue

            const cid = computeCidFromTokenId(tokenIdHex)
            if (!cid) continue

            // Only keep if this CID is in our missing set
            if (missingCids.has(cid.toLowerCase())) {
              pairs.push({ tx_hash: txHash, cid })
            }
          }

          if (pairs.length > 0) {
            // Insert in batches of 1000
            for (let i = 0; i < pairs.length; i += 1000) {
              const batch = pairs.slice(i, i + 1000)
              await insertRepairPairs(batch)
            }

            totalPairs += pairs.length
          }
        }

        // Rate limiting between addresses
        await sleep(100)

      } catch (e: any) {
        console.warn(
          `[Worker ${workerId}] Error for ${address} blocks ${block}-${blockEnd}: ${e.message.substring(0, 60)}`
        )
      }
    }

    // Save checkpoint every shard
    checkpoint.workers[workerId] = { lastBlock: blockEnd, pairsFound: totalPairs }
    saveCheckpoint(checkpoint)

    // Progress update
    if (totalPairs > 0 && totalPairs % 10000 === 0) {
      console.log(`[Worker ${workerId}] Found ${totalPairs.toLocaleString()} repair pairs (blocks ${startBlock.toLocaleString()}-${block.toLocaleString()})`)
    }
  }

  return totalPairs
}

async function main() {
  console.log('='.repeat(100))
  console.log(`GATE B RECOVERY - STEP 2: Blockchain Backfill with ${WORKER_COUNT} Workers`)
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set in .env.local')
    process.exit(1)
  }

  try {
    const checkpoint = loadCheckpoint()

    // Step 1: Load candidate addresses
    console.log('\n[1/4] Loading candidate CTF addresses...')
    const addrResult = await clickhouse.query({
      query: 'SELECT addr FROM _candidate_ctf_addresses',
      format: 'JSONEachRow'
    })
    const addresses = (await addrResult.json<{ addr: string }>()).map(r => r.addr)
    console.log(`✅ Loaded ${addresses.length} candidate CTF addresses`)

    // Step 2: Get block range
    console.log('\n[2/4] Determining block range...')
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    const currentBlock = parseInt(blockHex, 16)

    // Polymarket CTF deployed around block 37515000
    const START_BLOCK = 37515000
    const totalBlocks = currentBlock - START_BLOCK
    const blocksPerWorker = Math.ceil(totalBlocks / WORKER_COUNT)

    console.log(`Current block: ${currentBlock.toLocaleString()}`)
    console.log(`Start block: ${START_BLOCK.toLocaleString()}`)
    console.log(`Total blocks: ${totalBlocks.toLocaleString()}`)
    console.log(`Blocks per worker: ${blocksPerWorker.toLocaleString()}`)
    console.log(`Estimated time: 30-90 minutes with ${WORKER_COUNT} workers`)

    // Step 3: Create worker ranges
    console.log('\n[3/4] Creating worker ranges...')
    const workerRanges = []
    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = START_BLOCK + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : START_BLOCK + ((i + 1) * blocksPerWorker)
      workerRanges.push({ id: i + 1, start, end })
    }
    console.log(`✅ Created ${workerRanges.length} worker ranges`)

    // Step 4: Launch workers
    console.log('\n[4/4] Launching parallel workers...')
    console.log('─'.repeat(100))

    const startTime = Date.now()
    const workerPromises = workerRanges.map(range =>
      processBlockRange(addresses, range.start, range.end, range.id, checkpoint)
        .then(count => {
          console.log(`✅ Worker ${range.id} complete: ${count.toLocaleString()} repair pairs`)
          return count
        })
        .catch(e => {
          console.error(`❌ Worker ${range.id} failed: ${e.message}`)
          return 0
        })
    )

    const results = await Promise.all(workerPromises)
    const totalPairs = results.reduce((a, b) => a + b, 0)
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    // Results
    console.log('\n' + '='.repeat(100))
    console.log('BLOCKCHAIN BACKFILL COMPLETE')
    console.log('='.repeat(100))
    console.log(`Total repair pairs found: ${totalPairs.toLocaleString()}`)
    console.log(`Time elapsed: ${elapsed} minutes`)
    console.log(`Avg rate: ${(totalPairs / parseFloat(elapsed) / 60).toFixed(0)} pairs/sec`)

    // Clean up checkpoint
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE)
      console.log(`✅ Checkpoint cleaned up`)
    }

    // Verify staging table
    const countResult = await clickhouse.query({
      query: 'SELECT count() as count FROM repair_pairs_temp',
      format: 'JSONEachRow'
    })
    const count = await countResult.json<{ count: string }>()
    console.log(`\nVerification: repair_pairs_temp has ${parseInt(count[0].count).toLocaleString()} rows`)

    // Top CIDs by tx count
    console.log('\nTop 10 CIDs by transaction count:')
    const topCids = await clickhouse.query({
      query: `
        SELECT cid, count() as tx_count
        FROM repair_pairs_temp
        GROUP BY cid
        ORDER BY tx_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const topCidsResult = await topCids.json<{ cid: string; tx_count: string }>()
    topCidsResult.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.cid}: ${parseInt(row.tx_count).toLocaleString()} transactions`)
    })

    console.log(`\nNext: Run gate-b-step3-patch-fact-table.ts to apply patches`)

  } catch (error: any) {
    console.error('❌ Backfill error:', error.message)
    console.log(`\n💾 Checkpoint saved. Restart to resume from last completed block.`)
    process.exit(1)
  }
}

main().catch(console.error)
