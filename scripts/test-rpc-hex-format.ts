#!/usr/bin/env npx tsx

/**
 * Test different RPC block number formats to find what Alchemy accepts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''

async function testFormat(label: string, fromBlock: any, toBlock: any) {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [{
          address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
          topics: ['0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'],
          fromBlock,
          toBlock
        }]
      })
    })

    const data = await response.json()
    if (data.error) {
      console.log(`❌ ${label}: ${data.error.message}`)
    } else {
      console.log(`✅ ${label}: Got ${(data.result || []).length} results`)
    }
  } catch (e: any) {
    console.log(`❌ ${label}: ${e.message}`)
  }
}

async function main() {
  console.log('Testing RPC block number formats...\n')

  // Test 1: "latest" (known to work)
  await testFormat('"latest"', 'latest', 'latest')

  // Test 2: Decimal number (JSON-RPC standard)
  await testFormat('Decimal number: 78732532', 78732532 - 1000, 78732532)

  // Test 3: Decimal string
  await testFormat('Decimal string: "78732532"', '78732532', '78732532')

  // Test 4: Hex with 0x and proper padding (16-char = 8 bytes)
  const hexBlock = `0x${(78732532 - 1000).toString(16).padStart(8, '0')}`
  console.log(`\nHex value: ${hexBlock}`)
  await testFormat('Hex with 0x padStart(8)', hexBlock, `0x${(78732532).toString(16).padStart(8, '0')}`)

  // Test 5: Simple hex with 0x (no padding)
  await testFormat('Simple hex with 0x', `0x${(78732532 - 1000).toString(16)}`, `0x${(78732532).toString(16)}`)
}

main().catch(console.error)
