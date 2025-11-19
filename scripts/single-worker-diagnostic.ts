#!/usr/bin/env npx tsx
/**
 * SINGLE WORKER DIAGNOSTIC
 * Test if RPC → ClickHouse pipeline works at all
 * No parallelism, full error logging
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  console.log(`[RPC] Calling ${method}...`)
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
  console.log(`[RPC] Got response: ${data.result ? 'SUCCESS' : 'ERROR'}`)
  if (data.error) throw new Error(`RPC: ${data.error.message}`)
  return data.result
}

async function main() {
  console.log('=== SINGLE WORKER DIAGNOSTIC ===\n')

  try {
    // Test 1: Fetch from RPC
    console.log('[TEST 1] Fetching RPC logs for block range...')
    const logs = await fetchFromRPC('eth_getLogs', [
      {
        address: CONDITIONAL_TOKENS,
        topics: [TRANSFER_BATCH_SIG],
        fromBlock: '0x23d4858',  // 37,515,000
        toBlock: '0x23d4859'     // 37,515,001
      }
    ])
    console.log(`✅ Got ${logs.length} events\n`)

    if (logs.length === 0) {
      console.log('No events in this block range, testing next range...')
      const logs2 = await fetchFromRPC('eth_getLogs', [
        {
          address: CONDITIONAL_TOKENS,
          topics: [TRANSFER_BATCH_SIG],
          fromBlock: '0x3b9ac9f',  // 62,500,000
          toBlock: '0x3b9aca0'     // 62,500,001
        }
      ])
      console.log(`✅ Got ${logs2.length} events from next range\n`)
    }

    // Test 2: Build INSERT statement
    console.log('[TEST 2] Building INSERT statement...')
    const sampleLog = logs.length > 0 ? logs[0] : {
      transactionHash: '0x123',
      logIndex: '0x0',
      blockNumber: '0x23d4858',
      address: CONDITIONAL_TOKENS,
      topics: [TRANSFER_BATCH_SIG, '0x0', '0x0', '0x123'],
      data: '0x',
      blockTimestamp: Math.floor(Date.now() / 1000)
    }

    const txHash = (sampleLog.transactionHash || '').replace(/'/g, "''")
    const address = (sampleLog.address || '').replace(/'/g, "''")
    const tokenId = (sampleLog.topics?.[3] || '').replace(/'/g, "''")
    const fromAddr = (sampleLog.topics?.[1] || '').replace(/'/g, "''")
    const toAddr = (sampleLog.topics?.[2] || '').replace(/'/g, "''")
    const dataValue = (sampleLog.data || '').replace(/'/g, "''")
    const blockNum = parseInt(sampleLog.blockNumber || '0', 16)
    const logIdx = parseInt(sampleLog.logIndex || '0', 16)

    const insertSQL = `INSERT INTO erc1155_transfers
      (tx_hash, log_index, block_number, block_timestamp, contract, token_id, from_address, to_address, value, operator, decoded_data, raw_json)
      VALUES ('${txHash}', ${logIdx}, ${blockNum}, now(), '${address}', '${tokenId}', '${fromAddr}', '${toAddr}', 0, '', '', '${dataValue}')`

    console.log(`✅ INSERT statement built (${insertSQL.length} chars)\n`)

    // Test 3: Execute INSERT
    console.log('[TEST 3] Executing INSERT...')
    const result = await clickhouse.query({
      query: insertSQL
    })
    console.log(`✅ INSERT result: ${result}\n`)

    // Test 4: Verify data in table
    console.log('[TEST 4] Querying table to verify insert...')
    await sleep(1000) // Give ClickHouse 1 sec to process
    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
    })
    const countText = await countResult.text()
    console.log(`✅ Current row count: ${countText}\n`)

    console.log('=== ALL TESTS PASSED ===')
  } catch (error) {
    console.error(`\n❌ ERROR:`, error)
    process.exit(1)
  }
}

main()
