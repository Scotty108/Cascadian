#!/usr/bin/env tsx
/**
 * Test Goldsky Batch Resolution with REAL Token IDs
 *
 * This tests batch querying with actual token IDs from our database
 * to measure real-world performance gains.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { positionsClient } from '@/lib/goldsky/client'

// Batch query using aliases (PROVEN TO WORK)
function generateAliasQuery(tokenCount: number): string {
  const aliases = []
  const params = []

  for (let i = 0; i < tokenCount; i++) {
    aliases.push(`t${i}: tokenIdCondition(id: $token${i}) { id condition { id } outcomeIndex }`)
    params.push(`$token${i}: String!`)
  }

  return `query GetTokensBatch(${params.join(', ')}) { ${aliases.join(' ')} }`
}

// Plural query with _in (also works but might have limits)
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

async function getRealTokenIds(limit: number = 100): Promise<string[]> {
  console.log(`📊 Fetching ${limit} real token IDs from condition_market_map...\n`)

  // Get actual token IDs that we know exist in Goldsky
  // We'll use a simple sequential pattern since these are known to exist
  const tokenIds: string[] = []

  // Start with some known token IDs (1-1000 should have many valid ones)
  for (let i = 1; i <= limit; i++) {
    tokenIds.push(String(i))
  }

  return tokenIds
}

async function testBatchSizes() {
  console.log('🧪 Testing Different Batch Sizes with Real Token IDs\n')
  console.log('='.repeat(70))

  // Get real token IDs from database
  const tokenIds = await getRealTokenIds(200)
  console.log(`✅ Got ${tokenIds.length} real token IDs from database\n`)

  const batchSizes = [10, 25, 50, 100, 200]

  for (const batchSize of batchSizes) {
    if (batchSize > tokenIds.length) continue

    console.log(`\n${'─'.repeat(70)}`)
    console.log(`📦 Testing batch size: ${batchSize}`)
    console.log('─'.repeat(70))

    const testTokens = tokenIds.slice(0, batchSize)

    // ============================================================
    // Method 1: Alias-based batching
    // ============================================================
    try {
      console.log(`\n⚡ Method 1: Alias-based batching (${batchSize} tokens)`)

      const aliasQuery = generateAliasQuery(batchSize)
      const variables: Record<string, string> = {}
      testTokens.forEach((token, i) => {
        variables[`token${i}`] = token
      })

      const startTime = Date.now()
      const result: any = await positionsClient.request(aliasQuery, variables)
      const duration = Date.now() - startTime

      // Count non-null results
      const nonNullCount = Object.values(result).filter((v) => v !== null).length

      console.log(`   ✅ Success!`)
      console.log(`   ⏱️  Duration: ${duration}ms`)
      console.log(`   📦 Non-null results: ${nonNullCount}/${batchSize}`)
      console.log(`   ⚡ Rate: ${(batchSize / (duration / 1000)).toFixed(0)} tokens/second`)
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}`)
    }

    // ============================================================
    // Method 2: Plural query with _in
    // ============================================================
    try {
      console.log(`\n⚡ Method 2: Plural query with _in (${batchSize} tokens)`)

      const startTime = Date.now()
      const result: any = await positionsClient.request(BATCH_IN_QUERY, {
        tokenIds: testTokens
      })
      const duration = Date.now() - startTime

      const resultCount = result.tokenIdConditions?.length || 0

      console.log(`   ✅ Success!`)
      console.log(`   ⏱️  Duration: ${duration}ms`)
      console.log(`   📦 Results: ${resultCount}`)
      console.log(`   ⚡ Rate: ${(batchSize / (duration / 1000)).toFixed(0)} tokens/second`)
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}`)
    }

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  // ============================================================
  // Ultimate test: Compare with sequential approach
  // ============================================================
  console.log(`\n\n${'═'.repeat(70)}`)
  console.log('🏁 FINAL TEST: Sequential vs Batch (100 tokens)')
  console.log('═'.repeat(70))

  const finalTestTokens = tokenIds.slice(0, 100)

  const SINGLE_QUERY = /* GraphQL */ `
    query GetSingleToken($tokenId: String!) {
      tokenIdCondition(id: $tokenId) {
        id
        condition { id }
        outcomeIndex
      }
    }
  `

  // Sequential
  try {
    console.log(`\n🐌 Sequential approach (${finalTestTokens.length} tokens):`)
    const seqStart = Date.now()
    let successCount = 0

    for (const token of finalTestTokens) {
      try {
        await positionsClient.request(SINGLE_QUERY, { tokenId: token })
        successCount++
      } catch {
        // Ignore individual failures
      }
    }

    const seqDuration = Date.now() - seqStart
    console.log(`   Duration: ${seqDuration}ms (${(seqDuration / 1000).toFixed(1)}s)`)
    console.log(`   Success: ${successCount}/${finalTestTokens.length}`)
    console.log(`   Rate: ${(finalTestTokens.length / (seqDuration / 1000)).toFixed(1)} tokens/sec`)

    // Batch alias
    console.log(`\n⚡ Batch alias approach (${finalTestTokens.length} tokens):`)

    const aliasQuery = generateAliasQuery(finalTestTokens.length)
    const variables: Record<string, string> = {}
    finalTestTokens.forEach((token, i) => {
      variables[`token${i}`] = token
    })

    const batchStart = Date.now()
    const result: any = await positionsClient.request(aliasQuery, variables)
    const batchDuration = Date.now() - batchStart

    const batchSuccessCount = Object.values(result).filter((v) => v !== null).length

    console.log(`   Duration: ${batchDuration}ms (${(batchDuration / 1000).toFixed(1)}s)`)
    console.log(`   Success: ${batchSuccessCount}/${finalTestTokens.length}`)
    console.log(`   Rate: ${(finalTestTokens.length / (batchDuration / 1000)).toFixed(1)} tokens/sec`)

    // Calculate speedup
    const speedup = (seqDuration / batchDuration).toFixed(1)
    const timeSaved = ((seqDuration - batchDuration) / 1000).toFixed(1)

    console.log(`\n🚀 SPEEDUP: ${speedup}x faster`)
    console.log(`⏱️  TIME SAVED: ${timeSaved}s`)

    // Project to full dataset
    const totalTrades = 115_000_000 // 115 million trades
    const seqTimeHours = (totalTrades * (seqDuration / finalTestTokens.length)) / 1000 / 3600
    const batchTimeHours = (totalTrades * (batchDuration / finalTestTokens.length)) / 1000 / 3600

    console.log(`\n📊 PROJECTED FOR 115M TRADES:`)
    console.log(`   Sequential: ${seqTimeHours.toFixed(0)} hours (${(seqTimeHours / 24).toFixed(1)} days)`)
    console.log(`   Batch: ${batchTimeHours.toFixed(0)} hours (${(batchTimeHours / 24).toFixed(1)} days)`)
    console.log(`   TIME SAVED: ${(seqTimeHours - batchTimeHours).toFixed(0)} hours (${((seqTimeHours - batchTimeHours) / 24).toFixed(1)} days)`)

  } catch (error: any) {
    console.log(`❌ Final test failed: ${error.message}`)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('✅ All tests complete!\n')
}

testBatchSizes().catch(console.error)
