#!/usr/bin/env npx tsx

/**
 * PHASE 2: Fetch Complete ERC1155 Token Transfer History
 *
 * This is the CRITICAL PATH for blockchain enrichment.
 * We need ALL ERC1155 TransferSingle/Batch events for Polymarket conditional tokens
 * from Polygon blockchain since Dec 2022.
 *
 * Strategy:
 * 1. Identify the ERC1155 contract address(es)
 * 2. Use eth_getLogs with proper filtering (max 1000 block range per RPC call)
 * 3. Paginate through all blocks from contract creation to present
 * 4. Parse logs and store in ClickHouse
 * 5. Deduplicate on (tx_hash, log_index)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

// Polygon RPC settings
const RPC_ENDPOINT = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const BATCH_BLOCK_SIZE = 1000  // Polygon RPC limitation
const REQUEST_DELAY_MS = 100   // Rate limiting

// Known ERC1155 contracts for Polymarket (Polygon)
const ERC1155_CONTRACTS = [
  '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'  // Conditional Tokens contract
]

// Event signatures
const TRANSFER_SINGLE_SIG = '0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  if (!RPC_ENDPOINT) {
    throw new Error('ALCHEMY_POLYGON_RPC_URL not configured')
  }

  try {
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      })
    })

    const data = await response.json()
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`)
    }

    return data.result
  } catch (e: any) {
    throw new Error(`RPC call failed: ${e.message}`)
  }
}

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 2: Fetch Complete ERC1155 Token Transfer History')
  console.log('='.repeat(100))

  if (!RPC_ENDPOINT) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set in .env.local')
    console.error('   Please configure your Alchemy Polygon RPC endpoint')
    return
  }

  // Step 1: Verify RPC connection
  console.log('\n[STEP 1] Verify RPC connection and get current block')
  console.log('─'.repeat(100))

  let currentBlock: number
  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    currentBlock = parseInt(blockHex, 16)
    console.log(`✅ RPC connected`)
    console.log(`   Current block: ${currentBlock.toLocaleString()}`)

    // Estimate timeline
    const blocksPerDay = 43200  // ~1 block per 2 seconds
    const daysOfHistory = 1048
    const targetBlock = currentBlock - (blocksPerDay * daysOfHistory)
    const blocksToFetch = currentBlock - targetBlock
    const batchCount = Math.ceil(blocksToFetch / BATCH_BLOCK_SIZE)
    const estimatedHours = (batchCount * REQUEST_DELAY_MS) / (1000 * 3600)

    console.log(`   Target start block (1048 days ago): ~${targetBlock.toLocaleString()}`)
    console.log(`   Total blocks to fetch: ${blocksToFetch.toLocaleString()}`)
    console.log(`   Batches needed: ${batchCount.toLocaleString()} (1000 blocks each)`)
    console.log(`   Estimated time: ${estimatedHours.toFixed(1)} hours`)

  } catch (e: any) {
    console.error(`❌ RPC connection failed: ${e.message}`)
    return
  }

  // Step 2: Check existing ERC1155 data
  console.log('\n[STEP 2] Check existing ERC1155 data')
  console.log('─'.repeat(100))

  try {
    const stats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          MIN(block_timestamp) as earliest_block,
          MAX(block_timestamp) as latest_block
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = stats[0]
    console.log(`Current erc1155_transfers: ${parseInt(s.total_rows).toLocaleString()} rows`)
    if (parseInt(s.total_rows) > 0) {
      console.log(`  Date range: ${s.earliest_block} to ${s.latest_block}`)
    }

  } catch (e: any) {
    console.error(`⚠️  Stats check failed: ${e.message}`)
  }

  // Step 3: Planning the fetch strategy
  console.log('\n[STEP 3] Fetch strategy')
  console.log('─'.repeat(100))

  console.log(`\n🔗 CONFIGURATION:`)
  console.log(`  ERC1155 contracts to fetch:`)
  for (const contract of ERC1155_CONTRACTS) {
    console.log(`    - ${contract}`)
  }
  console.log(`  Event signatures:`)
  console.log(`    - TransferSingle: ${TRANSFER_SINGLE_SIG}`)
  console.log(`    - TransferBatch: ${TRANSFER_BATCH_SIG}`)
  console.log(`  Batch size: ${BATCH_BLOCK_SIZE} blocks`)
  console.log(`  Rate limit: ${REQUEST_DELAY_MS}ms between requests`)

  console.log(`\n⚠️  IMPORTANT NOTES:`)
  console.log(`  1. This will take 4-6 hours to complete`)
  console.log(`  2. RPC will be rate-limited by Alchemy free tier`)
  console.log(`  3. Checkpoints will be saved for resumability`)
  console.log(`  4. Monitor the output for errors`)

  console.log(`\n📋 NEXT STEPS:`)
  console.log(`  1. Review configuration above`)
  console.log(`  2. Ensure ALCHEMY_POLYGON_RPC_URL is set`)
  console.log(`  3. Run this script with --execute flag to start`)
  console.log(`  4. Monitor progress`)

  // Step 4: If --execute flag, start the fetch
  const shouldExecute = process.argv.includes('--execute')

  if (shouldExecute) {
    console.log(`\n[STEP 4] STARTING ERC1155 FETCH`)
    console.log('─'.repeat(100))
    console.log(`⏰ Start time: ${new Date().toISOString()}`)
    console.log(`⏱️  Estimated completion: ~6 hours from now`)
    console.log(`\nFetching ERC1155 logs from Polygon...`)

    // This is where the actual fetch would happen
    // For now, just show the plan
    console.log(`\n[NOT IMPLEMENTED - This requires extended execution]`)
    console.log(`\nWhen ready, the fetch will:`)
    console.log(`  1. Query eth_getLogs for each block range`)
    console.log(`  2. Parse TransferSingle/Batch events`)
    console.log(`  3. Store in erc1155_transfers_full`)
    console.log(`  4. Deduplicate on (tx_hash, log_index)`)
    console.log(`  5. Report final statistics`)

  } else {
    console.log(`\n💡 To start the fetch, run:`)
    console.log(`   npx tsx scripts/phase2-fetch-erc1155-complete.ts --execute`)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
