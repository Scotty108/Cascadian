#!/usr/bin/env npx tsx
/**
 * ERC-1155 INCREMENTAL BACKFILL
 * 
 * Safely backfill missing ERC1155 data from last known block to current.
 * 
 * Safety:
 * - Inserts into EXISTING table (no drops)
 * - Checkpoint system for resume
 * - Verifies data before/after
 * 
 * Usage:
 *   npx tsx scripts/pnl/erc1155-incremental-backfill.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../../lib/clickhouse/client'
import * as fs from 'fs'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'

// Configuration
const WORKER_COUNT = 8
const BLOCKS_PER_REQUEST = 500  // Smaller to avoid hitting maxCount limit
const CHECKPOINT_FILE = 'tmp/erc1155-incremental.checkpoint.json'
const RATE_LIMIT_MS = 100  // ~10 requests/second per worker
const FORCE_START_BLOCK = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : null

interface CheckpointState {
  startBlock: number
  endBlock: number
  processedBlocks: number[]
  totalInserted: number
  startTime: number
}

interface TransferRow {
  tx_hash: string
  log_index: number
  block_number: number
  block_timestamp: string
  contract: string
  token_id: string
  from_address: string
  to_address: string
  value: string
  operator: string
  is_deleted: number
}

function loadCheckpoint(): CheckpointState | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
    }
  } catch (e) {}
  return null
}

function saveCheckpoint(state: CheckpointState) {
  const dir = 'tmp'
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(state, null, 2))
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function getLatestBlock(): Promise<number> {
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: []
    })
  })
  const data = await resp.json()
  return parseInt(data.result, 16)
}

async function fetchTransfers(fromBlock: number, toBlock: number, retries = 3): Promise<any[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Math.random(),
          method: 'alchemy_getAssetTransfers',
          params: [{
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
            contractAddresses: [CTF_CONTRACT],
            category: ['erc1155'],
            maxCount: '0x3e8',
            withMetadata: true,
            excludeZeroValue: false
          }]
        })
      })

      const data = await resp.json()
      if (data.error) {
        if (data.error.code === 429 || data.error.message?.includes('rate')) {
          await sleep(Math.pow(2, attempt) * 2000)
          continue
        }
        throw new Error(data.error.message)
      }
      return data.result?.transfers || []
    } catch (e: any) {
      if (attempt === retries - 1) throw e
      await sleep(Math.pow(2, attempt) * 1000)
    }
  }
  return []
}

function convertToRows(transfers: any[]): TransferRow[] {
  const rows: TransferRow[] = []
  for (const t of transfers) {
    const blockNum = parseInt(t.blockNum, 16)
    const timestamp = t.metadata?.blockTimestamp || '1970-01-01T00:00:00Z'
    const logIndex = t.uniqueId?.split(':')[2] ? parseInt(t.uniqueId.split(':')[2]) : 0

    if (t.erc1155Metadata) {
      for (const token of t.erc1155Metadata) {
        rows.push({
          tx_hash: t.hash,
          log_index: logIndex,
          block_number: blockNum,
          block_timestamp: timestamp,
          contract: t.rawContract.address,
          token_id: token.tokenId,
          from_address: t.from,
          to_address: t.to,
          value: token.value,
          operator: t.from,
          is_deleted: 0
        })
      }
    }
  }
  return rows
}

async function insertRows(rows: TransferRow[]) {
  if (rows.length === 0) return
  await clickhouse.insert({
    table: 'pm_erc1155_transfers',
    values: rows,
    format: 'JSONEachRow'
  })
}

async function processRange(
  workerId: number,
  ranges: [number, number][],
  state: CheckpointState
): Promise<number> {
  let inserted = 0

  for (const [fromBlock, toBlock] of ranges) {
    if (state.processedBlocks.includes(fromBlock)) continue

    try {
      const transfers = await fetchTransfers(fromBlock, toBlock)
      const rows = convertToRows(transfers)
      
      if (rows.length > 0) {
        await insertRows(rows)
        inserted += rows.length
      }

      state.processedBlocks.push(fromBlock)
      state.totalInserted += rows.length

      if (state.processedBlocks.length % 50 === 0) {
        saveCheckpoint(state)
        const progress = (state.processedBlocks.length / Math.ceil((state.endBlock - state.startBlock) / BLOCKS_PER_REQUEST) * 100).toFixed(1)
        console.log(`Worker ${workerId}: ${progress}% - ${state.totalInserted.toLocaleString()} rows inserted`)
      }

      await sleep(RATE_LIMIT_MS)
    } catch (e: any) {
      console.error(`Worker ${workerId} error at block ${fromBlock}: ${e.message}`)
      saveCheckpoint(state)
      await sleep(5000)
    }
  }

  return inserted
}

async function main() {
  console.log('\n🚀 ERC-1155 Incremental Backfill\n')

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    process.exit(1)
  }

  // Get current state
  const result = await clickhouse.query({
    query: 'SELECT max(block_number) as max_block, count() as total FROM pm_erc1155_transfers WHERE is_deleted = 0',
    format: 'JSONEachRow'
  })
  const current = (await result.json() as any[])[0]
  const startBlock = FORCE_START_BLOCK || (Number(current.max_block) + 1)
  
  const latestBlock = await getLatestBlock()
  const blocksToProcess = latestBlock - startBlock
  
  console.log('Current state:')
  console.log(`  Existing rows: ${Number(current.total).toLocaleString()}`)
  console.log(`  Last block: ${(startBlock - 1).toLocaleString()}`)
  console.log(`  Latest chain block: ${latestBlock.toLocaleString()}`)
  console.log(`  Blocks to backfill: ${blocksToProcess.toLocaleString()}`)
  console.log(`  Estimated requests: ${Math.ceil(blocksToProcess / BLOCKS_PER_REQUEST).toLocaleString()}`)
  console.log(`  Workers: ${WORKER_COUNT}\n`)

  if (blocksToProcess <= 0) {
    console.log('✅ Already up to date!')
    return
  }

  // Load or create checkpoint
  let state = loadCheckpoint()
  if (!state || state.startBlock !== startBlock) {
    state = {
      startBlock,
      endBlock: latestBlock,
      processedBlocks: [],
      totalInserted: 0,
      startTime: Date.now()
    }
  }

  // Create work ranges
  const ranges: [number, number][] = []
  for (let block = startBlock; block < latestBlock; block += BLOCKS_PER_REQUEST) {
    ranges.push([block, Math.min(block + BLOCKS_PER_REQUEST - 1, latestBlock)])
  }

  // Distribute to workers
  const workerRanges: [number, number][][] = Array.from({ length: WORKER_COUNT }, () => [])
  ranges.forEach((range, i) => {
    workerRanges[i % WORKER_COUNT].push(range)
  })

  console.log('🔄 Starting workers...\n')

  const workers = workerRanges.map((wr, i) => processRange(i, wr, state!))
  await Promise.all(workers)

  // Final stats
  const duration = (Date.now() - state.startTime) / 1000 / 60
  console.log('\n✅ Backfill complete!')
  console.log(`  Total inserted: ${state.totalInserted.toLocaleString()} rows`)
  console.log(`  Duration: ${duration.toFixed(1)} minutes`)

  // Verify
  const verify = await clickhouse.query({
    query: 'SELECT max(block_number) as max_block, count() as total FROM pm_erc1155_transfers WHERE is_deleted = 0',
    format: 'JSONEachRow'
  })
  const final = (await verify.json() as any[])[0]
  console.log(`  New total: ${Number(final.total).toLocaleString()} rows`)
  console.log(`  New max block: ${Number(final.max_block).toLocaleString()}`)

  // Cleanup checkpoint
  if (fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE)
  }
}

main().catch(e => {
  console.error('❌ Fatal:', e)
  process.exit(1)
})
