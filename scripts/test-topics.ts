#!/usr/bin/env npx tsx

const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"

async function test() {
  // Test with address + topics
  console.log('TEST: With address + topics')
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{
        address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
        topics: [['0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e', '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb']],
        fromBlock: 'latest',
        toBlock: 'latest'
      }]
    })
  })

  const data = await response.json()
  if (data.error) {
    console.log(`Error: ${data.error.message}`)
  } else {
    console.log(`Success! Got ${data.result.length} logs`)
  }
}

test()
