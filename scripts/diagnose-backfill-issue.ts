#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  const start = Date.now()
  try {
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
    const elapsed = Date.now() - start

    if (data.error) {
      console.log(`❌ RPC ERROR (${elapsed}ms): ${data.error.message}`)
      return null
    }

    console.log(`✅ RPC call took ${elapsed}ms`)
    return data.result
  } catch (e: any) {
    const elapsed = Date.now() - start
    console.log(`❌ FETCH ERROR (${elapsed}ms): ${e.message}`)
    return null
  }
}

async function main() {
  console.log('Testing RPC performance...\n')

  // Test 1: eth_blockNumber (fast)
  console.log('[TEST 1] eth_blockNumber (should be <100ms)')
  const blockNum = await fetchFromRPC('eth_blockNumber', [])
  if (!blockNum) return

  const blockDec = parseInt(blockNum, 16)
  console.log(`Current block: ${blockDec}\n`)

  // Test 2: eth_getLogs with small range (100 blocks)
  console.log('[TEST 2] eth_getLogs with 100-block range')
  const startBlock = blockDec - 1000
  const result = await fetchFromRPC('eth_getLogs', [
    {
      address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
      topics: ['0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'],
      fromBlock: `0x${startBlock.toString(16)}`,
      toBlock: `0x${(startBlock + 100).toString(16)}`
    }
  ])

  if (result) {
    console.log(`Got ${result.length} events\n`)
  }

  // Test 3: eth_getLogs with 1000-block range
  console.log('[TEST 3] eth_getLogs with 1000-block range (like backfill)')
  const result2 = await fetchFromRPC('eth_getLogs', [
    {
      address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
      topics: ['0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'],
      fromBlock: `0x${startBlock.toString(16)}`,
      toBlock: `0x${(startBlock + 1000).toString(16)}`
    }
  ])

  if (result2) {
    console.log(`Got ${result2.length} events\n`)
  }

  // Test 4: Simulate what 32 workers would do - sequential
  console.log('[TEST 4] Simulating 3 sequential RPC calls with 10ms delay')
  for (let i = 1; i <= 3; i++) {
    console.log(`Worker ${i} starting...`)
    const block = blockDec - (2000 * i)
    await fetchFromRPC('eth_getLogs', [
      {
        address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
        topics: ['0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'],
        fromBlock: `0x${block.toString(16)}`,
        toBlock: `0x${(block + 1000).toString(16)}`
      }
    ])
    await sleep(10)
  }

  console.log('\n✅ Diagnostic complete')
}

main().catch(e => console.error(e))
