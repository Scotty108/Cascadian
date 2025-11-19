#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const RPC_URL = `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`

console.log('\n' + '='.repeat(100))
console.log('Testing RPC endpoint connectivity')
console.log('='.repeat(100))
console.log(`RPC URL: ${RPC_URL.substring(0, 80)}...`)

async function testRPC() {
  try {
    // Test 1: Simple getBlockNumber (should always work)
    console.log('\n📋 Test 1: eth_blockNumber')
    const blockResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      })
    })
    const blockData = await blockResponse.json()
    if (blockData.error) {
      console.log(`❌ Error: ${blockData.error.message}`)
    } else {
      const blockNum = parseInt(blockData.result, 16)
      console.log(`✅ Current block: ${blockNum.toLocaleString()}`)
    }
    
    // Test 2: Try eth_getLogs with large block range (decimal)
    console.log('\n📋 Test 2: eth_getLogs with decimal block numbers')
    const logsResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_getLogs',
        params: [{
          address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
          fromBlock: 'latest',
          toBlock: 'latest'
        }]
      })
    })
    const logsData = await logsResponse.json()
    if (logsData.error) {
      console.log(`❌ Error: ${logsData.error.message}`)
    } else {
      console.log(`✅ Got logs response (${logsData.result.length} results)`)
    }
    
    // Test 3: Try with hex block numbers (proper format)
    console.log('\n📋 Test 3: eth_getLogs with hex strings (latest)')
    const logsHexResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'eth_getLogs',
        params: [{
          address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
          topics: [['0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e']],
          fromBlock: 'latest',
          toBlock: 'latest'
        }]
      })
    })
    const logsHexData = await logsHexResponse.json()
    if (logsHexData.error) {
      console.log(`❌ Error: ${logsHexData.error.message}`)
    } else {
      console.log(`✅ Got logs response (${logsHexData.result.length} results)`)
    }
    
  } catch (e: any) {
    console.error(`\n❌ Network error: ${e.message}`)
  }
}

testRPC()
