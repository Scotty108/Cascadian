#!/usr/bin/env npx tsx

const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"

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
  console.log('Full RPC Response:', JSON.stringify(data, null, 2))
  if (data.error) throw new Error(`RPC: ${data.error.message}`)
  return data.result
}

async function test() {
  const currentBlock = 78732204
  const block = 77522604
  const blockEnd = 77523603

  console.log(`Testing with block range: ${block} to ${blockEnd}`)

  // Helper function to format hex without odd length or leading zeros
  const toHex = (num: number): string => {
    let hex = num.toString(16)
    // If odd length, prepend '0' to make it even
    if (hex.length % 2 !== 0) {
      hex = '0' + hex
    }
    return '0x' + hex
  }

  const fromBlockHex = toHex(block)
  const toBlockHex = toHex(blockEnd)

  console.log(`Block ${block} → hex: ${fromBlockHex}`)
  console.log(`Block ${blockEnd} → hex: ${toBlockHex}`)
  console.log(`Request body:`)

  const reqBody = {
    address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
    topics: [['0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e', '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb']],
    fromBlock: fromBlockHex,
    toBlock: toBlockHex
  }
  console.log(JSON.stringify(reqBody, null, 2))

  try {
    const logs = await fetchFromRPC('eth_getLogs', [reqBody])
    console.log(`Success! Got ${logs.length} logs`)
  } catch (e: any) {
    console.error(`Failed: ${e.message}`)
  }

  // Try with decimal instead
  console.log(`\n\nTrying with decimal block numbers instead:`)
  const reqBody2 = {
    address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
    topics: [['0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e', '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb']],
    fromBlock: block.toString(),
    toBlock: blockEnd.toString()
  }
  console.log(JSON.stringify(reqBody2, null, 2))

  try {
    const logs = await fetchFromRPC('eth_getLogs', [reqBody2])
    console.log(`Success with decimal! Got ${logs.length} logs`)
  } catch (e: any) {
    console.error(`Failed with decimal: ${e.message}`)
  }
}

test()
