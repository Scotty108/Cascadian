#!/usr/bin/env npx tsx
/**
 * TEST ALCHEMY TRANSFERS API
 *
 * Test Alchemy's alchemy_getAssetTransfers API on 100 blocks
 * This API is much faster than eth_getLogs and includes timestamps
 *
 * Test parameters:
 * - Block range: 0x3200000 (52,428,800) to 0x3200064 (100 blocks)
 * - Contract: Polymarket CTF Exchange
 * - Category: ERC-1155 transfers
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CTF_EXCHANGE = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'

interface AlchemyTransfer {
  blockNum: string
  hash: string
  from: string
  to: string
  value: string | null
  erc1155Metadata: Array<{
    tokenId: string
    value: string
  }> | null
  asset: string | null
  category: string
  rawContract: {
    address: string
    value: string | null
  }
  metadata?: {
    blockTimestamp: string
  }
}

interface AlchemyResponse {
  transfers: AlchemyTransfer[]
  pageKey?: string
}

async function testAlchemyTransfersAPI() {
  console.log('\n🧪 Testing Alchemy Transfers API...\n')

  // Test parameters
  const startBlock = '0x3200000' // 52,428,800
  const endBlock = '0x3200064'   // 52,428,900 (100 blocks)

  console.log('Test parameters:')
  console.log(`  Start block: ${startBlock} (${parseInt(startBlock, 16)})`)
  console.log(`  End block: ${endBlock} (${parseInt(endBlock, 16)})`)
  console.log(`  Contract: ${CTF_EXCHANGE}`)
  console.log(`  Category: ERC-1155\n`)

  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getAssetTransfers',
        params: [{
          fromBlock: startBlock,
          toBlock: endBlock,
          contractAddresses: [CTF_EXCHANGE],
          category: ['erc1155'],
          maxCount: '0x3e8', // 1000 results max
          withMetadata: true,
          excludeZeroValue: false
        }]
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`)
    }

    const result = data.result as AlchemyResponse

    console.log('✅ API call successful!\n')
    console.log('Results:')
    console.log(`  Total transfers: ${result.transfers.length}`)
    console.log(`  Has more pages: ${result.pageKey ? 'Yes' : 'No'}`)
    if (result.pageKey) {
      console.log(`  Page key: ${result.pageKey.substring(0, 50)}...`)
    }

    // Analyze first transfer
    if (result.transfers.length > 0) {
      console.log('\n📊 Sample transfer:')
      const sample = result.transfers[0]
      console.log(`  Block: ${sample.blockNum} (${parseInt(sample.blockNum, 16)})`)
      console.log(`  Tx hash: ${sample.hash}`)
      console.log(`  From: ${sample.from}`)
      console.log(`  To: ${sample.to}`)
      console.log(`  Category: ${sample.category}`)

      if (sample.erc1155Metadata && sample.erc1155Metadata.length > 0) {
        console.log(`  Token ID: ${sample.erc1155Metadata[0].tokenId}`)
        console.log(`  Value: ${sample.erc1155Metadata[0].value}`)
      }

      if (sample.metadata?.blockTimestamp) {
        console.log(`  Timestamp: ${sample.metadata.blockTimestamp}`)
        console.log(`  ✅ Timestamp included!`)
      } else {
        console.log(`  ⚠️  No timestamp in metadata`)
      }

      console.log('\nFull sample transfer:')
      console.log(JSON.stringify(sample, null, 2))
    }

    // Check if we need pagination
    if (result.pageKey) {
      console.log('\n⚠️  Note: This block range has more results than maxCount (1000)')
      console.log('    Will need pagination in full backfill script')
    }

    // Summary
    console.log('\n📈 Test Summary:')
    console.log(`  ✅ API works correctly`)
    console.log(`  ✅ Returns ${result.transfers.length} transfers`)
    console.log(`  ${result.transfers[0]?.metadata?.blockTimestamp ? '✅' : '⚠️'}  Timestamps ${result.transfers[0]?.metadata?.blockTimestamp ? 'included' : 'NOT included'}`)
    console.log(`  ${!result.pageKey ? '✅' : '⚠️'}  ${!result.pageKey ? 'No' : 'Has'} pagination needed`)

    // Estimate full backfill
    const blocksPerRequest = 100
    const transfersPerBlock = result.transfers.length / blocksPerRequest
    const totalBlocks = 100_000_000 - 52_000_000 // Rough estimate
    const estimatedTransfers = totalBlocks * transfersPerBlock
    const estimatedRequests = totalBlocks / blocksPerRequest

    console.log('\n⏱️  Full Backfill Estimates:')
    console.log(`  Transfers per block: ~${transfersPerBlock.toFixed(2)}`)
    console.log(`  Estimated total transfers: ~${estimatedTransfers.toLocaleString()}`)
    console.log(`  Estimated requests needed: ~${estimatedRequests.toLocaleString()}`)
    console.log(`  With 8 workers @ 1 req/sec: ~${(estimatedRequests / 8 / 60).toFixed(0)} minutes`)

    return result

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message)
    if (error.stack) {
      console.error('\nStack trace:')
      console.error(error.stack)
    }
    throw error
  }
}

// Run test
testAlchemyTransfersAPI()
  .then(() => {
    console.log('\n✅ Test complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message)
    process.exit(1)
  })
