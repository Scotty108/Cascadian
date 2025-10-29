#!/usr/bin/env tsx
/**
 * Find Maximum Batch Size for Goldsky Plural Query
 *
 * Tests increasingly large batch sizes to find the optimal batch size
 * before hitting query complexity limits or timeouts.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { positionsClient } from '@/lib/goldsky/client'

const BATCH_IN_QUERY = /* GraphQL */ `
  query GetMultipleTokens($tokenIds: [String!]!) {
    tokenIdConditions(where: { id_in: $tokenIds }) {
      id
      condition {
        id
      }
      outcomeIndex
    }
  }
`

async function testBatchSize(batchSize: number): Promise<{
  success: boolean
  duration: number
  resultCount: number
  error?: string
}> {
  const tokenIds = Array.from({ length: batchSize }, (_, i) => String(i + 1))

  try {
    const startTime = Date.now()
    const result: any = await positionsClient.request(BATCH_IN_QUERY, { tokenIds })
    const duration = Date.now() - startTime

    return {
      success: true,
      duration,
      resultCount: result.tokenIdConditions?.length || 0
    }
  } catch (error: any) {
    return {
      success: false,
      duration: 0,
      resultCount: 0,
      error: error.message
    }
  }
}

async function findMaxBatchSize() {
  console.log('🔍 Finding Maximum Batch Size for Goldsky Plural Query\n')
  console.log('='.repeat(70))

  // Test exponentially increasing batch sizes
  const testSizes = [
    100, 200, 500, 1000, 2000, 3000, 4000, 5000,
    7500, 10000, 15000, 20000, 25000, 50000
  ]

  let maxWorkingSize = 0
  let maxWorkingDuration = 0

  for (const size of testSizes) {
    console.log(`\n📦 Testing batch size: ${size.toLocaleString()}`)
    console.log('─'.repeat(70))

    const result = await testBatchSize(size)

    if (result.success) {
      console.log(`✅ SUCCESS`)
      console.log(`   Duration: ${result.duration}ms (${(result.duration / 1000).toFixed(2)}s)`)
      console.log(`   Results: ${result.resultCount}`)
      console.log(`   Rate: ${(size / (result.duration / 1000)).toFixed(0)} tokens/sec`)

      maxWorkingSize = size
      maxWorkingDuration = result.duration

      // If query takes more than 30 seconds, stop here
      if (result.duration > 30000) {
        console.log(`\n⚠️  Query took ${(result.duration / 1000).toFixed(1)}s - stopping here`)
        break
      }
    } else {
      console.log(`❌ FAILED: ${result.error}`)
      console.log(`\n🛑 Hit limit at batch size ${size.toLocaleString()}`)
      break
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`\n\n${'═'.repeat(70)}`)
  console.log('📊 RESULTS')
  console.log('═'.repeat(70))
  console.log(`✅ Maximum working batch size: ${maxWorkingSize.toLocaleString()}`)
  console.log(`⏱️  Duration at max size: ${maxWorkingDuration}ms (${(maxWorkingDuration / 1000).toFixed(2)}s)`)
  console.log(`⚡ Rate at max size: ${(maxWorkingSize / (maxWorkingDuration / 1000)).toFixed(0)} tokens/sec`)

  // Calculate optimal batch size (aim for 5-10 second queries for reliability)
  const optimalBatchSize = Math.floor(maxWorkingSize * (8000 / maxWorkingDuration))
  console.log(`\n💡 RECOMMENDED BATCH SIZE: ${optimalBatchSize.toLocaleString()}`)
  console.log(`   (Optimized for ~8 second queries)`)

  // Project performance for full dataset
  const totalTrades = 115_000_000
  const avgUniqueTokensPerTrade = 1 // Each trade needs 1 token lookup

  const totalTokensToResolve = totalTrades * avgUniqueTokensPerTrade
  const timePerBatch = 8 // Target 8 seconds per batch
  const tokensPerBatch = optimalBatchSize

  const totalBatches = Math.ceil(totalTokensToResolve / tokensPerBatch)
  const totalTimeSeconds = totalBatches * timePerBatch
  const totalTimeHours = totalTimeSeconds / 3600
  const totalTimeDays = totalTimeHours / 24

  console.log(`\n📊 PROJECTED PERFORMANCE FOR 115M TRADES:`)
  console.log(`   Total tokens to resolve: ${totalTokensToResolve.toLocaleString()}`)
  console.log(`   Number of batches: ${totalBatches.toLocaleString()}`)
  console.log(`   Total time: ${totalTimeHours.toFixed(1)} hours (${totalTimeDays.toFixed(2)} days)`)

  console.log(`\n${'═'.repeat(70)}`)
  console.log('✅ Testing complete!\n')
}

findMaxBatchSize().catch(console.error)
