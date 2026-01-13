/**
 * Manual ERC1155 Sync Script
 *
 * Run this to manually backfill pm_erc1155_transfers when the cron is failing.
 * Usage: npx tsx scripts/manual-erc1155-sync.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const BLOCKS_PER_REQUEST = 500
const MAX_BLOCKS_PER_RUN = 5000 // Larger batch for manual runs

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

async function getLatestBlock(): Promise<number> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const resp = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      }),
      signal: controller.signal
    })
    const data = await resp.json()
    if (data.error) throw new Error(`RPC error: ${data.error.message}`)
    if (!data.result) throw new Error('No result from eth_blockNumber')
    return parseInt(data.result, 16)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchTransfers(fromBlock: number, toBlock: number): Promise<any[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

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
      }),
      signal: controller.signal
    })

    const data = await resp.json()
    if (data.error) throw new Error(`Alchemy error: ${data.error.message}`)
    return data.result?.transfers || []
  } finally {
    clearTimeout(timeout)
  }
}

function convertToRows(transfers: any[]): TransferRow[] {
  const rows: TransferRow[] = []
  for (const t of transfers) {
    const blockNum = parseInt(t.blockNum, 16)
    const isoTimestamp = t.metadata?.blockTimestamp || '1970-01-01T00:00:00Z'
    const timestamp = isoTimestamp.replace('T', ' ').replace('Z', '').split('.')[0]
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

async function main() {
  console.log('🔄 Manual ERC1155 Sync Starting...\n')

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not configured in .env.local')
    process.exit(1)
  }

  console.log('✅ RPC URL configured')

  // Get current state
  const result = await clickhouse.query({
    query: 'SELECT max(block_number) as max_block FROM pm_erc1155_transfers WHERE is_deleted = 0',
    format: 'JSONEachRow'
  })
  const current = (await result.json() as any[])[0]
  const startBlock = Number(current.max_block) + 1
  console.log(`📊 Current max block: ${startBlock - 1}`)

  const latestBlock = await getLatestBlock()
  console.log(`📊 Chain latest block: ${latestBlock}`)

  const blocksToProcess = Math.min(latestBlock - startBlock, MAX_BLOCKS_PER_RUN)
  console.log(`📊 Blocks to process: ${blocksToProcess}`)

  if (blocksToProcess <= 0) {
    console.log('✅ Already up to date!')
    return
  }

  const endBlock = startBlock + blocksToProcess
  let totalInserted = 0

  console.log(`\n🚀 Processing blocks ${startBlock} to ${endBlock}...\n`)

  for (let block = startBlock; block < endBlock; block += BLOCKS_PER_REQUEST) {
    const chunkEnd = Math.min(block + BLOCKS_PER_REQUEST - 1, endBlock - 1)

    process.stdout.write(`  Block ${block}-${chunkEnd}...`)

    try {
      const transfers = await fetchTransfers(block, chunkEnd)
      const rows = convertToRows(transfers)

      if (rows.length > 0) {
        await clickhouse.insert({
          table: 'pm_erc1155_transfers',
          values: rows,
          format: 'JSONEachRow'
        })
        totalInserted += rows.length
        console.log(` ${rows.length} rows`)
      } else {
        console.log(' 0 rows')
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200))
    } catch (err: any) {
      console.log(` ❌ Error: ${err.message}`)
      throw err
    }
  }

  console.log(`\n✅ Done! Inserted ${totalInserted} total rows`)
  console.log(`   From block ${startBlock} to ${endBlock - 1}`)

  // Show new state
  const newResult = await clickhouse.query({
    query: 'SELECT max(block_number) as max_block, max(block_timestamp) as latest FROM pm_erc1155_transfers WHERE is_deleted = 0',
    format: 'JSONEachRow'
  })
  const newState = (await newResult.json() as any[])[0]
  console.log(`   New max block: ${newState.max_block}`)
  console.log(`   Latest timestamp: ${newState.latest}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Fatal error:', err)
    process.exit(1)
  })
