import { pnlClient, positionsClient, orderbookClient } from '../lib/goldsky/client'

async function checkFasterApproaches() {
  console.log('Checking for faster wallet discovery approaches...\n')

  // Check 1: PnL subgraph - can we get all users with their totalBought?
  console.log('1️⃣  Checking PnL subgraph for aggregated user stats...')
  const pnlQuery = `
  {
    userPositions(first: 10, orderBy: totalBought, orderDirection: desc) {
      user
      totalBought
    }
  }
  `

  try {
    const pnlData = await pnlClient.request(pnlQuery)
    console.log('   ✅ PnL subgraph has userPositions with totalBought!')
    console.log('   Sample:', JSON.stringify(pnlData, null, 2))
  } catch (err: any) {
    console.log('   ❌ Error:', err.message)
  }

  // Check 2: Can we get a count or list of all unique users?
  console.log('\n2️⃣  Checking for User entity in PnL subgraph...')
  const userQuery = `
  {
    users(first: 10) {
      id
      volume
    }
  }
  `

  try {
    const userData = await pnlClient.request(userQuery)
    console.log('   ✅ Found User entity!')
    console.log('   Sample:', JSON.stringify(userData, null, 2))
  } catch (err: any) {
    console.log('   ❌ No User entity:', err.message.split('\n')[0])
  }

  // Check 3: Positions subgraph
  console.log('\n3️⃣  Checking positions subgraph for user aggregations...')
  const posQuery = `
  {
    userBalances(first: 5) {
      user
      balance
    }
  }
  `

  try {
    const posData = await positionsClient.request(posQuery)
    console.log('   ✅ Positions subgraph accessible')
    console.log('   Sample:', JSON.stringify(posData, null, 2))
  } catch (err: any) {
    console.log('   ❌ Error:', err.message)
  }

  console.log('\n4️⃣  Checking Polymarket CLOB API...')
  console.log('   Checking if there\'s a users endpoint...')

  // Try Polymarket's CLOB API
  try {
    const response = await fetch('https://clob.polymarket.com/users', {
      headers: { 'Accept': 'application/json' }
    })

    if (response.ok) {
      const data = await response.json()
      console.log('   ✅ CLOB API users endpoint exists!')
      console.log('   Response:', JSON.stringify(data, null, 2))
    } else {
      console.log('   ❌ Endpoint returned:', response.status)
    }
  } catch (err: any) {
    console.log('   ❌ CLOB API error:', err.message)
  }

  console.log('\n📊 SUMMARY:')
  console.log('   Current approach: Process all orderFilledEvents (slow but accurate)')
  console.log('   Checking if we can use pre-aggregated user data instead...')
}

checkFasterApproaches().catch(console.error)
