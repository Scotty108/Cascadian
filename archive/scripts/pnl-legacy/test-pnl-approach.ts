import { pnlClient } from '../lib/goldsky/client'

async function testPnLApproach() {
  console.log('Testing PnL subgraph approach for wallet discovery...\n')

  // Test 1: Can we paginate through all userPositions?
  const query = `
    query GetUserPositions($skip: Int!) {
      userPositions(first: 1000, skip: $skip, orderBy: totalBought, orderDirection: desc) {
        user
        totalBought
      }
    }
  `

  console.log('Fetching first 3,000 positions to test pagination...')
  const walletVolumes = new Map<string, number>()
  let totalPositions = 0

  for (let skip = 0; skip < 3000; skip += 1000) {
    const data = await pnlClient.request<{ userPositions: Array<{ user: string, totalBought: string }> }>(query, { skip })

    console.log(`  Page ${skip / 1000 + 1}: ${data.userPositions.length} positions`)

    if (data.userPositions.length === 0) {
      console.log('  Reached end of data')
      break
    }

    // Aggregate by user
    data.userPositions.forEach(pos => {
      const volume = parseFloat(pos.totalBought) / 1e6 // Convert to USDC
      walletVolumes.set(pos.user, (walletVolumes.get(pos.user) || 0) + volume)
    })

    totalPositions += data.userPositions.length

    if (data.userPositions.length < 1000) {
      console.log('  Last page detected')
      break
    }
  }

  console.log(`\nAggregated ${totalPositions} positions into ${walletVolumes.size} unique wallets`)

  // Show top 10
  const sorted = Array.from(walletVolumes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  console.log('\nTop 10 wallets by volume:')
  sorted.forEach(([ wallet, volume ], i) => {
    console.log(`  ${i + 1}. ${wallet}: $${volume.toLocaleString()}`)
  })

  console.log('\n⚠️  ISSUE: This gives us POSITION volume (totalBought per market)')
  console.log('   NOT lifetime trading volume across all trades.')
  console.log('   totalBought = how much they bought for THIS position')
  console.log('   We need TOTAL volume = sum of all trade amounts')
}

testPnLApproach().catch(console.error)
