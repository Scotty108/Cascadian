#!/usr/bin/env npx tsx

/**
 * TEST: Transaction Receipt Based Recovery
 * 
 * Sample transaction_hashes from trades with missing condition_ids
 * Query eth_getTransactionReceipt for each
 * Decode ERC1155 TransferBatch events from logs
 * Measure recovery rate
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''

let stats = {
  sampled: 0,
  rpcCalls: 0,
  receiptsFound: 0,
  logsFound: 0,
  erc1155Decoded: 0,
  costEstimate: 0
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  stats.rpcCalls++
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
  if (data.error) {
    throw new Error(`RPC Error: ${data.error.message}`)
  }
  return data.result
}

async function main() {
  console.log('═'.repeat(100))
  console.log('TEST: Transaction Receipt Based Recovery')
  console.log('═'.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  try {
    // STEP 1: Sample transaction hashes
    console.log('\n[STEP 1] Sampling transaction_hashes from missing condition_ids...')
    const sampleResult = await clickhouse.query({
      query: `
        SELECT transaction_hash
        FROM trades_raw
        WHERE (condition_id = '' OR condition_id IS NULL)
        AND transaction_hash != ''
        ORDER BY RAND()
        LIMIT 100
      `
    })

    const sampleText = await sampleResult.text()
    let sampleData: any = { data: [] }
    try {
      sampleData = JSON.parse(sampleText)
    } catch (e) {
      console.error('Failed to parse sample data')
      return
    }

    const txHashes: string[] = []
    if (sampleData.data && Array.isArray(sampleData.data)) {
      for (const row of sampleData.data) {
        const hash = row.transaction_hash
        if (hash) txHashes.push(hash)
      }
    }

    console.log(`✅ Sample size: ${txHashes.length} transaction hashes`)
    if (txHashes.length === 0) {
      console.error('❌ No transaction hashes found')
      return
    }

    // STEP 2: Query receipts
    console.log(`\n[STEP 2] Querying eth_getTransactionReceipt for ${txHashes.length} transactions...`)
    
    const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
    let erc1155Match = 0

    for (let i = 0; i < txHashes.length; i++) {
      try {
        const receipt = await fetchFromRPC('eth_getTransactionReceipt', [txHashes[i]])
        
        if (receipt && receipt.logs && Array.isArray(receipt.logs)) {
          stats.receiptsFound++
          stats.logsFound += receipt.logs.length

          // Check for ERC1155 TransferBatch events
          for (const log of receipt.logs) {
            if (log.topics && log.topics[0] === TRANSFER_BATCH_SIG) {
              erc1155Match++
              break  // Found at least one for this tx
            }
          }
        }

        if ((i + 1) % 10 === 0) {
          process.stdout.write(`\r  Progress: ${i + 1}/${txHashes.length} (${erc1155Match} with ERC1155 events)`)
          await sleep(100)
        }

      } catch (e: any) {
        console.error(`\n  ❌ TX ${txHashes[i]}: ${e.message}`)
      }
    }

    console.log(`\n✅ Receipts retrieved: ${stats.receiptsFound} / ${txHashes.length}`)
    console.log(`✅ ERC1155 TransferBatch found: ${erc1155Match} / ${stats.receiptsFound}`)

    const recoveryRate = (erc1155Match / stats.receiptsFound * 100).toFixed(2)
    console.log(`✅ Recovery rate: ${recoveryRate}%`)

    // STEP 3: Extrapolate
    console.log(`\n[STEP 3] Extrapolation to full dataset...`)
    const estimatedRecoverable = Math.floor(32020330 * (erc1155Match / stats.receiptsFound))
    console.log(`📊 Estimated condition_ids recoverable: ${estimatedRecoverable.toLocaleString()} / 32,020,330`)
    console.log(`📊 Estimated coverage: ${(estimatedRecoverable / 32020330 * 100).toFixed(2)}%`)

    // STEP 4: Cost estimate
    console.log(`\n[STEP 4] Full backfill estimates...`)
    const costPerReceipt = 0.0001  // Alchemy cost
    const totalCost = 32020330 * costPerReceipt
    const avgTimePerReceipt = 0.2  // seconds
    const totalTime = (32020330 * avgTimePerReceipt) / (8 * 3600)  // 8 workers, convert to hours
    
    console.log(`💰 Estimated RPC cost: $${totalCost.toFixed(2)}`)
    console.log(`⏱️  Estimated time (8 workers): ${totalTime.toFixed(1)} hours`)

    // FINAL RECOMMENDATION
    console.log('\n' + '═'.repeat(100))
    console.log('TEST RESULTS & RECOMMENDATION')
    console.log('═'.repeat(100))

    if (erc1155Match / stats.receiptsFound > 0.7) {
      console.log(`\n✅ SUCCESS: ${recoveryRate}% recovery rate is VIABLE`)
      console.log(`\nRECOMMENDATION: Proceed with full transaction receipt backfill`)
      console.log(`- Recover ~${estimatedRecoverable.toLocaleString()} condition_ids`)
      console.log(`- Cost: $${totalCost.toFixed(2)} RPC`)
      console.log(`- Time: ~${totalTime.toFixed(1)} hours`)
      console.log(`- Combined with 81.6M valid trades = ~${(81600000 + estimatedRecoverable).toLocaleString()} total`)
    } else if (erc1155Match / stats.receiptsFound > 0.3) {
      console.log(`\n⚠️  PARTIAL: ${recoveryRate}% recovery rate is MARGINAL`)
      console.log(`- Would recover ~${estimatedRecoverable.toLocaleString()} condition_ids`)
      console.log(`- Cost/benefit may not justify full backfill`)
    } else {
      console.log(`\n❌ FAILED: ${recoveryRate}% recovery rate is too LOW`)
      console.log(`- Condition_id likely NOT in ERC1155 events`)
      console.log(`- Need alternative recovery method`)
    }

    console.log('\n' + '═'.repeat(100))
    console.log(`RPC calls used in test: ${stats.rpcCalls}`)
    console.log(`Estimated cost of this test: $${(stats.rpcCalls * 0.0001).toFixed(3)}`)

  } catch (e: any) {
    console.error(`\n❌ Error: ${e.message}`)
  }
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
