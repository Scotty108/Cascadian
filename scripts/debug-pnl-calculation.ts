import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { pnlClient } from '@/lib/goldsky/client'

async function debugPnL() {
  const wallet = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'

  console.log('🔍 Debug PnL Calculation\n')
  console.log(`Wallet: ${wallet}`)
  console.log(`Polymarket Profile: https://polymarket.com/@Mynxx\n`)

  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1000) {
        id
        user
        tokenId
        amount
        avgPrice
        realizedPnl
        totalBought
      }
    }
  `

  const data = await pnlClient.request<any>(query, {
    wallet: wallet.toLowerCase(),
  })

  const positions = data.userPositions

  console.log(`Found ${positions.length} positions\n`)

  // Check a few sample positions
  console.log('Sample positions (first 5):')
  positions.slice(0, 5).forEach((p: any, i: number) => {
    console.log(`\n${i + 1}. Token ID: ${p.tokenId}`)
    console.log(`   Realized PnL (raw): ${p.realizedPnl}`)
    console.log(`   Amount: ${p.amount}`)
    console.log(`   Avg Price: ${p.avgPrice}`)
    console.log(`   Total Bought: ${p.totalBought}`)
  })

  // Calculate total with different decimal assumptions
  let totalRaw = 0
  let totalDiv1e6 = 0
  let totalDiv1e18 = 0
  let nonZeroCount = 0

  positions.forEach((p: any) => {
    const pnl = parseFloat(p.realizedPnl)
    if (pnl !== 0) nonZeroCount++

    totalRaw += pnl
    totalDiv1e6 += pnl / 1e6
    totalDiv1e18 += pnl / 1e18
  })

  console.log('\n\n📊 Total PnL Calculations:')
  console.log(`Positions with non-zero PnL: ${nonZeroCount}`)
  console.log(`\nTotal (raw): ${totalRaw}`)
  console.log(`Total (÷ 1e6 USDC): ${totalDiv1e6.toFixed(2)}`)
  console.log(`Total (÷ 1e18 wei): ${totalDiv1e18.toFixed(2)}`)

  console.log('\n\n💡 Analysis:')
  console.log(`Polymarket shows: $31,904 all-time profit`)
  console.log(`Our calculation: $${totalDiv1e6.toFixed(2)}`)
  console.log(`\nDiscrepancy: ${((totalDiv1e6 / 31904) * 100).toFixed(0)}% of expected`)

  // Check if we're double counting
  console.log('\n\n🔍 Checking for duplicates...')
  const uniqueTokenIds = new Set(positions.map((p: any) => p.tokenId))
  console.log(`Total positions: ${positions.length}`)
  console.log(`Unique token IDs: ${uniqueTokenIds.size}`)
  if (positions.length !== uniqueTokenIds.size) {
    console.log(`⚠️  WARNING: Multiple positions per token ID detected!`)
    console.log(`   This might explain the discrepancy.`)
  }
}

debugPnL()
