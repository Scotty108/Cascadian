#!/usr/bin/env npx tsx

/**
 * DIAGNOSTIC: Where is the backfill bottleneck?
 * Measures:
 * 1. RPC latency (eth_getLogs for 1000 blocks)
 * 2. ClickHouse insert latency (100-row batch)
 * 3. Total cycle time
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
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
  if (data.error) throw new Error(`RPC: ${data.error.message}`)
  return data.result
}

async function main() {
  console.log('═'.repeat(100))
  console.log('BACKFILL BOTTLENECK DIAGNOSTIC')
  console.log('═'.repeat(100))

  try {
    // Get current block
    console.log('\n[STEP 1] Get current block number...')
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    const currentBlock = parseInt(blockHex, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}`)

    // Test 1: RPC latency with different block ranges
    console.log('\n[STEP 2] Measure RPC latency (eth_getLogs)')
    console.log('─'.repeat(100))

    const testRanges = [
      { name: '1K blocks (current)', start: currentBlock - 1000, size: 1000 },
      { name: '5K blocks', start: currentBlock - 5000, size: 5000 },
      { name: '10K blocks', start: currentBlock - 10000, size: 10000 }
    ]

    for (const range of testRanges) {
      const start = Date.now()
      try {
        const logs = await fetchFromRPC('eth_getLogs', [
          {
            address: CONDITIONAL_TOKENS,
            topics: [TRANSFER_BATCH_SIG],
            fromBlock: `0x${range.start.toString(16)}`,
            toBlock: `0x${(range.start + range.size - 1).toString(16)}`
          }
        ])
        const elapsed = Date.now() - start
        console.log(`${range.name.padEnd(25)} → ${elapsed}ms (${logs?.length || 0} events)`)
      } catch (e: any) {
        const elapsed = Date.now() - start
        console.log(`${range.name.padEnd(25)} → ERROR after ${elapsed}ms: ${e.message.substring(0, 40)}`)
      }
    }

    // Test 2: ClickHouse insert latency
    console.log('\n[STEP 3] Measure ClickHouse insert latency')
    console.log('─'.repeat(100))

    // Create test table
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS erc1155_test_perf`
    })
    await clickhouse.query({
      query: `
        CREATE TABLE erc1155_test_perf (
          tx_hash String,
          log_index UInt32,
          block_number UInt32,
          contract String,
          token_id String,
          from_address String,
          to_address String,
          value String
        ) ENGINE=MergeTree()
        ORDER BY (block_number, tx_hash, log_index)
      `
    })

    const insertSizes = [10, 50, 100, 500]
    for (const size of insertSizes) {
      // Build test rows
      const values: string[] = []
      for (let i = 0; i < size; i++) {
        values.push(
          `('0xtxhash${i}', ${i}, ${currentBlock - i}, '${CONDITIONAL_TOKENS}', '0xtokenid${i}', '0xfrom${i}', '0xto${i}', '0xdata${i}')`
        )
      }

      const sql = `INSERT INTO erc1155_test_perf VALUES ${values.join(', ')}`
      const start = Date.now()
      try {
        await clickhouse.query({ query: sql })
        const elapsed = Date.now() - start
        console.log(`Insert ${size} rows → ${elapsed}ms`)
      } catch (e: any) {
        const elapsed = Date.now() - start
        console.log(`Insert ${size} rows → ERROR after ${elapsed}ms: ${e.message.substring(0, 40)}`)
      }
    }

    // Test 3: Combined cycle
    console.log('\n[STEP 4] Measure combined RPC+ClickHouse cycle (1 iteration)')
    console.log('─'.repeat(100))

    const cycleStart = Date.now()
    const testBlock = currentBlock - 2000
    const cycleLog = {
      rpc: 0,
      build: 0,
      insert: 0,
      total: 0
    }

    // RPC fetch
    let rpcStart = Date.now()
    const logs = await fetchFromRPC('eth_getLogs', [
      {
        address: CONDITIONAL_TOKENS,
        topics: [TRANSFER_BATCH_SIG],
        fromBlock: `0x${testBlock.toString(16)}`,
        toBlock: `0x${(testBlock + 999).toString(16)}`
      }
    ])
    cycleLog.rpc = Date.now() - rpcStart

    // Build VALUES
    let buildStart = Date.now()
    const values: string[] = []
    if (logs && logs.length > 0) {
      for (const log of logs) {
        const topics = log.topics || []
        const txHash = (log.transactionHash || '').replace(/'/g, "''")
        const address = (log.address || '').replace(/'/g, "''")
        const tokenId = (topics[3] || '').replace(/'/g, "''")
        const fromAddr = (topics[1] || '').replace(/'/g, "''")
        const toAddr = (topics[2] || '').replace(/'/g, "''")
        const dataValue = (log.data || '').replace(/'/g, "''")

        values.push(
          `('${txHash}', ${parseInt(log.logIndex || 0, 16)}, ${parseInt(log.blockNumber || 0, 16)}, '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', '${dataValue}')`
        )
      }
    }
    cycleLog.build = Date.now() - buildStart

    // Insert (100-row batch)
    let insertStart = Date.now()
    const BATCH_SIZE = 100
    let totalInsertTime = 0
    for (let i = 0; i < values.length; i += BATCH_SIZE) {
      const batch = values.slice(i, i + BATCH_SIZE)
      const sql = `INSERT INTO erc1155_test_perf VALUES ${batch.join(', ')}`
      const batchStart = Date.now()
      try {
        await clickhouse.query({ query: sql })
        totalInsertTime += Date.now() - batchStart
      } catch (e) {
        // ignore
      }
    }
    cycleLog.insert = totalInsertTime

    cycleLog.total = Date.now() - cycleStart

    console.log(`RPC fetch (1000 blocks): ${cycleLog.rpc}ms`)
    console.log(`Build VALUES (${values.length} rows): ${cycleLog.build}ms`)
    console.log(`Insert to ClickHouse (${Math.ceil(values.length / 100)} batches): ${cycleLog.insert}ms`)
    console.log(`───────────────────────────────────────────`)
    console.log(`Total cycle time: ${cycleLog.total}ms`)

    // Projection
    console.log('\n[STEP 5] Performance projection')
    console.log('─'.repeat(100))

    const fullBlockRange = 78_734_775 - 37_515_000
    const cyclesNeeded = Math.ceil(fullBlockRange / 1000)
    const estimatedTotal = (cycleLog.total * cyclesNeeded) / 1000 / 60 // in minutes

    console.log(`Full backfill: ${fullBlockRange.toLocaleString()} blocks`)
    console.log(`Cycles needed (1000 blocks/cycle): ${cyclesNeeded.toLocaleString()}`)
    console.log(`Average cycle time: ${cycleLog.total}ms`)
    console.log(`Estimated time (1 sequential worker): ${estimatedTotal.toFixed(1)} minutes`)
    console.log(`Estimated time (8 workers in parallel): ${(estimatedTotal / 8).toFixed(1)} minutes`)

    // Bottleneck analysis
    console.log('\n[STEP 6] Bottleneck analysis')
    console.log('─'.repeat(100))

    const pct = {
      rpc: ((cycleLog.rpc / cycleLog.total) * 100).toFixed(1),
      build: ((cycleLog.build / cycleLog.total) * 100).toFixed(1),
      insert: ((cycleLog.insert / cycleLog.total) * 100).toFixed(1)
    }

    console.log(`RPC: ${cycleLog.rpc}ms (${pct.rpc}%)`)
    console.log(`Build: ${cycleLog.build}ms (${pct.build}%)`)
    console.log(`Insert: ${cycleLog.insert}ms (${pct.insert}%)`)

    const bottleneck = cycleLog.rpc > cycleLog.insert ? 'RPC LATENCY' : 'CLICKHOUSE INSERT'
    console.log(`\n⚠️  BOTTLENECK: ${bottleneck}`)

    // Cleanup
    await clickhouse.query({ query: `DROP TABLE IF EXISTS erc1155_test_perf` })

  } catch (e: any) {
    console.error(`❌ Diagnostic failed: ${e.message}`)
  }

  console.log('\n' + '═'.repeat(100))
}

main().catch(e => console.error('Fatal:', e))
