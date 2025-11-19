#!/usr/bin/env npx tsx

const RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO"

async function test() {
  // Test 1: With single topic (not array)
  console.log('TEST 1: With single topic string')
  let response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{
        address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
        topics: ['0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e'],
        fromBlock: 'latest',
        toBlock: 'latest'
      }]
    })
  })

  let data = await response.json()
  if (data.error) {
    console.log(`Error: ${data.error.message}`)
  } else {
    console.log(`Success! Got ${data.result.length} logs`)
  }

  // Test 2: With OR array for single topic
  console.log('\nTEST 2: With array of topics for OR logic')
  response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_getLogs',
      params: [{
        address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
        topics: [['0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e', '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb']],
        fromBlock: 'latest',
        toBlock: 'latest'
      }]
    })
  })

  data = await response.json()
  if (data.error) {
    console.log(`Error: ${data.error.message}`)
  } else {
    console.log(`Success! Got ${data.result.length} logs`)
  }

  // Test 3: Check if it's the second topic that's problematic
  console.log('\nTEST 3: With just the second topic')
  response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'eth_getLogs',
      params: [{
        address: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
        topics: ['0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'],
        fromBlock: 'latest',
        toBlock: 'latest'
      }]
    })
  })

  data = await response.json()
  if (data.error) {
    console.log(`Error: ${data.error.message}`)
  } else {
    console.log(`Success! Got ${data.result.length} logs`)
  }
}

test()
