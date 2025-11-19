#!/usr/bin/env npx tsx

/**
 * PHASE 1 VALIDATION: Prove ERC1155 recovery strategy will work
 *
 * Before committing 4-7 hours to RPC backfill, sample 100 random missing trades
 * and verify they exist on-chain as ERC1155 events.
 *
 * Success criteria: >95% of sampled trades have ERC1155 events on-chain
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  if (!RPC_URL) {
    throw new Error('ALCHEMY_POLYGON_RPC_URL not configured')
  }

  try {
    const response = await fetch(RPC_URL, {
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
  console.log('PHASE 1 VALIDATION: Verify ERC1155 Recovery Strategy Will Work')
  console.log('='.repeat(100))

  const CONDITIONAL_TOKENS_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
  const TRANSFER_SINGLE_SIG = '0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e'
  const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

  // Step 1: Sample 100 random missing trades
  console.log('\n[STEP 1] Sample 100 random missing trades from trades_raw')
  console.log('─'.repeat(100))

  let sampleTrades: any[] = []
  try {
    const sample = await (await clickhouse.query({
      query: `
        SELECT
          transaction_hash,
          wallet_address,
          market_id,
          timestamp,
          created_at
        FROM trades_raw
        WHERE (condition_id = '' OR condition_id IS NULL)
        AND transaction_hash NOT LIKE '0x0%'  -- Skip malformed hashes
        ORDER BY RAND()
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    sampleTrades = sample
    console.log(`✅ Sampled ${sampleTrades.length} trades with missing condition_ids`)

    if (sampleTrades.length === 0) {
      console.log('❌ No valid trades found to sample!')
      return
    }

    // Show sample distribution
    const oldestTrade = new Date(Math.min(...sampleTrades.map(t => new Date(t.timestamp).getTime())))
    const newestTrade = new Date(Math.max(...sampleTrades.map(t => new Date(t.timestamp).getTime())))

    console.log(`   Date range: ${oldestTrade.toISOString()} to ${newestTrade.toISOString()}`)
    console.log(`   Sample hashes:`)
    for (let i = 0; i < Math.min(5, sampleTrades.length); i++) {
      console.log(`     - ${sampleTrades[i].transaction_hash.substring(0, 20)}...`)
    }

  } catch (e: any) {
    console.error(`❌ Failed to sample trades: ${e.message}`)
    return
  }

  // Step 2: Verify RPC connection
  console.log('\n[STEP 2] Verify RPC connection')
  console.log('─'.repeat(100))

  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    const currentBlock = parseInt(blockHex, 16)
    console.log(`✅ RPC connected`)
    console.log(`   Current block: ${currentBlock.toLocaleString()}`)
  } catch (e: any) {
    console.error(`❌ RPC connection failed: ${e.message}`)
    console.error(`   Please ensure ALCHEMY_POLYGON_RPC_URL is set correctly`)
    return
  }

  // Step 3: Check each sampled trade for ERC1155 events on-chain
  console.log('\n[STEP 3] Check for ERC1155 events on-chain (via RPC)')
  console.log('─'.repeat(100))
  console.log(`Querying RPC for ERC1155 TransferBatch events in each transaction...\n`)

  let foundCount = 0
  let notFoundCount = 0
  const results = []

  for (let i = 0; i < sampleTrades.length; i++) {
    const trade = sampleTrades[i]
    const txHash = trade.transaction_hash

    try {
      // Get transaction receipt to find logs
      const receipt = await fetchFromRPC('eth_getTransactionReceipt', [txHash])

      if (!receipt) {
        console.log(`[${i + 1}/${sampleTrades.length}] ❌ ${txHash.substring(0, 20)}... - No receipt found`)
        notFoundCount++
        results.push({ hash: txHash, found: false, reason: 'no_receipt' })
        continue
      }

      // Look for ERC1155 event logs
      const logs = receipt.logs || []
      const hasERC1155 = logs.some((log: any) => {
        const topics = log.topics || []
        return (
          log.address?.toLowerCase?.() === CONDITIONAL_TOKENS_CONTRACT.toLowerCase() &&
          (topics[0] === TRANSFER_SINGLE_SIG || topics[0] === TRANSFER_BATCH_SIG)
        )
      })

      if (hasERC1155) {
        console.log(`[${i + 1}/${sampleTrades.length}] ✅ ${txHash.substring(0, 20)}... - Found ERC1155 events`)
        foundCount++
        results.push({ hash: txHash, found: true, logCount: logs.length })
      } else {
        console.log(`[${i + 1}/${sampleTrades.length}] ❌ ${txHash.substring(0, 20)}... - No ERC1155 events (${logs.length} total logs)`)
        notFoundCount++
        results.push({ hash: txHash, found: false, reason: 'no_erc1155', logCount: logs.length })
      }

      // Rate limiting
      if ((i + 1) % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

    } catch (e: any) {
      console.log(`[${i + 1}/${sampleTrades.length}] ⚠️  ${txHash.substring(0, 20)}... - RPC error: ${e.message.substring(0, 40)}...`)
      notFoundCount++
      results.push({ hash: txHash, found: false, reason: 'rpc_error' })
    }
  }

  // Step 4: Analyze results
  console.log('\n[STEP 4] Validation Results')
  console.log('─'.repeat(100))

  const successRate = (foundCount / sampleTrades.length) * 100

  console.log(`\n📊 Summary:`)
  console.log(`  Total sampled: ${sampleTrades.length}`)
  console.log(`  Found ERC1155 events: ${foundCount}`)
  console.log(`  NOT found: ${notFoundCount}`)
  console.log(`  Success rate: ${successRate.toFixed(1)}%`)

  if (successRate >= 95) {
    console.log(`\n✅ VALIDATION PASSED - Recovery strategy will work!`)
    console.log(`\n   Next step: Execute Phase 2 RPC backfill`)
    console.log(`   Timeline: 4-7 hours (or 2-3 with full parallelization)`)
    console.log(`   Expected result: 73M+ trades with recovered condition_ids`)
  } else if (successRate >= 80) {
    console.log(`\n⚠️  PARTIAL SUCCESS - ${successRate.toFixed(1)}% recovery expected`)
    console.log(`   Still worth proceeding with Phase 2`)
  } else {
    console.log(`\n❌ VALIDATION FAILED - Recovery strategy may not work`)
    console.log(`   Success rate too low (${successRate.toFixed(1)}%)`)
    console.log(`   Consider alternative approaches`)
  }

  // Show failure analysis
  if (notFoundCount > 0) {
    console.log(`\n⚠️  Analysis of ${notFoundCount} trades without ERC1155 events:`)
    const reasons = results
      .filter(r => !r.found)
      .reduce((acc: any, r: any) => {
        acc[r.reason] = (acc[r.reason] || 0) + 1
        return acc
      }, {})

    for (const [reason, count] of Object.entries(reasons)) {
      console.log(`   ${reason}: ${count}`)
    }
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 1 VALIDATION COMPLETE')
  console.log('='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
