#!/usr/bin/env tsx
/**
 * Test Goldsky GraphQL Batch Query Patterns
 *
 * This script tests different approaches to batch querying token IDs:
 * 1. Plural query with _in operator (preferred)
 * 2. Alias-based batching (fallback)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { positionsClient } from '@/lib/goldsky/client'

// Test 1: Check if plural tokenIdConditions exists with _in operator
const TEST_BATCH_QUERY = /* GraphQL */ `
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

// Test 2: Alias-based batching (if plural doesn't work)
const TEST_ALIAS_QUERY_SMALL = /* GraphQL */ `
  query GetTokensWithAliases(
    $token1: String!,
    $token2: String!,
    $token3: String!
  ) {
    t1: tokenIdCondition(id: $token1) {
      id
      condition { id }
      outcomeIndex
    }
    t2: tokenIdCondition(id: $token2) {
      id
      condition { id }
      outcomeIndex
    }
    t3: tokenIdCondition(id: $token3) {
      id
      condition { id }
      outcomeIndex
    }
  }
`

// Test 3: Large alias batch (50 tokens)
function generateAliasQuery(tokenCount: number): string {
  const aliases = []
  const params = []

  for (let i = 0; i < tokenCount; i++) {
    aliases.push(`t${i}: tokenIdCondition(id: $token${i}) { id condition { id } outcomeIndex }`)
    params.push(`$token${i}: String!`)
  }

  return `query GetTokensBatch(${params.join(', ')}) { ${aliases.join(' ')} }`
}

async function test() {
  console.log('🧪 Testing Goldsky GraphQL Batch Query Patterns\n')
  console.log('=' .repeat(60))

  // Use some example token IDs (small numbers likely exist)
  const testTokens = ['1', '2', '3', '10', '20', '100']

  // ============================================================
  // Test 1: Plural query with _in operator
  // ============================================================
  console.log('\n📊 Test 1: Plural tokenIdConditions with id_in operator')
  console.log('-'.repeat(60))

  try {
    const startTime = Date.now()
    const result1: any = await positionsClient.request(TEST_BATCH_QUERY, {
      tokenIds: testTokens
    })
    const duration = Date.now() - startTime

    console.log('✅ SUCCESS! Plural query works!')
    console.log(`⏱️  Duration: ${duration}ms`)
    console.log(`📦 Returned ${result1.tokenIdConditions?.length || 0} tokens`)
    console.log('\nSample result:')
    console.log(JSON.stringify(result1.tokenIdConditions?.slice(0, 2), null, 2))
  } catch (error: any) {
    console.log('❌ Plural query failed:', error.message)
    if (error.response?.errors) {
      console.log('GraphQL errors:', JSON.stringify(error.response.errors, null, 2))
    }
  }

  // ============================================================
  // Test 2: Alias-based batching (small)
  // ============================================================
  console.log('\n\n📊 Test 2: Alias-based batching (3 tokens)')
  console.log('-'.repeat(60))

  try {
    const startTime = Date.now()
    const result2: any = await positionsClient.request(TEST_ALIAS_QUERY_SMALL, {
      token1: testTokens[0],
      token2: testTokens[1],
      token3: testTokens[2]
    })
    const duration = Date.now() - startTime

    console.log('✅ SUCCESS! Alias-based batching works!')
    console.log(`⏱️  Duration: ${duration}ms`)
    console.log(`📦 Returned ${Object.keys(result2).length} tokens`)
    console.log('\nSample result:')
    console.log(JSON.stringify(result2, null, 2))
  } catch (error2: any) {
    console.log('❌ Alias query failed:', error2.message)
    if (error2.response?.errors) {
      console.log('GraphQL errors:', JSON.stringify(error2.response.errors, null, 2))
    }
  }

  // ============================================================
  // Test 3: Large alias batch (50 tokens)
  // ============================================================
  console.log('\n\n📊 Test 3: Large alias batch (50 tokens)')
  console.log('-'.repeat(60))

  try {
    const largeTokenSet = Array.from({ length: 50 }, (_, i) => String(i + 1))
    const largeAliasQuery = generateAliasQuery(50)

    const variables: Record<string, string> = {}
    largeTokenSet.forEach((token, i) => {
      variables[`token${i}`] = token
    })

    const startTime = Date.now()
    const result3: any = await positionsClient.request(largeAliasQuery, variables)
    const duration = Date.now() - startTime

    console.log('✅ SUCCESS! Large alias batch works!')
    console.log(`⏱️  Duration: ${duration}ms`)
    console.log(`📦 Returned ${Object.keys(result3).length} tokens`)
    console.log(`⚡ Rate: ${(50 / (duration / 1000)).toFixed(0)} tokens/second`)
  } catch (error3: any) {
    console.log('❌ Large alias batch failed:', error3.message)
    if (error3.response?.errors) {
      console.log('GraphQL errors:', JSON.stringify(error3.response.errors, null, 2))
    }
  }

  // ============================================================
  // Test 4: Compare sequential vs batch
  // ============================================================
  console.log('\n\n📊 Test 4: Sequential vs Batch Performance')
  console.log('-'.repeat(60))

  const SINGLE_TOKEN_QUERY = /* GraphQL */ `
    query GetSingleToken($tokenId: String!) {
      tokenIdCondition(id: $tokenId) {
        id
        condition { id }
        outcomeIndex
      }
    }
  `

  try {
    const testSet = testTokens.slice(0, 3)

    // Sequential
    console.log(`\n🐌 Sequential (${testSet.length} tokens):`)
    const seqStart = Date.now()
    for (const token of testSet) {
      await positionsClient.request(SINGLE_TOKEN_QUERY, { tokenId: token })
    }
    const seqDuration = Date.now() - seqStart
    console.log(`   Duration: ${seqDuration}ms`)
    console.log(`   Rate: ${(testSet.length / (seqDuration / 1000)).toFixed(1)} tokens/sec`)

    // Batch
    console.log(`\n⚡ Batch (${testSet.length} tokens):`)
    const batchStart = Date.now()
    await positionsClient.request(TEST_ALIAS_QUERY_SMALL, {
      token1: testSet[0],
      token2: testSet[1],
      token3: testSet[2]
    })
    const batchDuration = Date.now() - batchStart
    console.log(`   Duration: ${batchDuration}ms`)
    console.log(`   Rate: ${(testSet.length / (batchDuration / 1000)).toFixed(1)} tokens/sec`)

    const speedup = (seqDuration / batchDuration).toFixed(1)
    console.log(`\n🚀 Speedup: ${speedup}x faster`)

  } catch (error4: any) {
    console.log('❌ Performance test failed:', error4.message)
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ Testing complete!\n')
}

test().catch(console.error)
