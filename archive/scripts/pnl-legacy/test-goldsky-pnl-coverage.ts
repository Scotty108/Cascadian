#!/usr/bin/env npx tsx

/**
 * Test Goldsky PnL Subgraph Coverage
 *
 * Questions to answer:
 * 1. Does realizedPnl actually work?
 * 2. What percentage of trades have valid realizedPnl?
 * 3. Can we use Goldsky's realizedPnl directly instead of our enrichment?
 */

import { pnlClient } from '../lib/goldsky/client'

const GET_SAMPLE_WALLETS_PNL = /* GraphQL */ `
  query GetSampleWalletsPnL {
    userPositions(first: 100, orderBy: realizedPnl, orderDirection: desc) {
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

const GET_SPECIFIC_WALLET_PNL = /* GraphQL */ `
  query GetWalletPnL($wallet: String!) {
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

async function testGoldskyPnLCoverage() {
  console.log('🔍 Testing Goldsky PnL Subgraph Coverage\n')
  console.log('='.repeat(50) + '\n')

  try {
    // Test 1: Get sample of positions with highest PnL
    console.log('📊 Test 1: Sample of Top PnL Positions')
    console.log('-'.repeat(50))

    const sampleData = await pnlClient.request<any>(GET_SAMPLE_WALLETS_PNL)
    const positions = sampleData.userPositions || []

    console.log(`Found ${positions.length} positions\n`)

    // Analyze the data
    const withRealizedPnl = positions.filter((p: any) => {
      const pnl = parseFloat(p.realizedPnl || '0')
      return pnl !== 0
    })

    const positivePnl = positions.filter((p: any) => parseFloat(p.realizedPnl || '0') > 0)
    const negativePnl = positions.filter((p: any) => parseFloat(p.realizedPnl || '0') < 0)

    console.log(`Positions with non-zero realizedPnl: ${withRealizedPnl.length}/${positions.length} (${((withRealizedPnl.length / positions.length) * 100).toFixed(1)}%)`)
    console.log(`Positions with positive PnL: ${positivePnl.length}`)
    console.log(`Positions with negative PnL: ${negativePnl.length}`)
    console.log(`Positions with zero PnL: ${positions.length - withRealizedPnl.length}\n`)

    // Show top 5 positions
    console.log('Top 5 Positions by Realized PnL:')
    positions.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`  [${i + 1}] Wallet: ${p.user.substring(0, 10)}...`)
      console.log(`      Token ID: ${p.tokenId}`)
      console.log(`      Realized PnL: $${parseFloat(p.realizedPnl).toFixed(2)}`)
      console.log(`      Amount: ${p.amount}`)
      console.log(`      Avg Price: ${parseFloat(p.avgPrice).toFixed(4)}\n`)
    })

    // Test 2: Pick a wallet from top performers and get all positions
    console.log('\n' + '='.repeat(50))
    console.log('📊 Test 2: Detailed Wallet Analysis')
    console.log('-'.repeat(50) + '\n')

    const testWallet = positions[0].user
    console.log(`Testing wallet: ${testWallet}\n`)

    const walletData = await pnlClient.request<any>(GET_SPECIFIC_WALLET_PNL, {
      wallet: testWallet,
    })

    const walletPositions = walletData.userPositions || []
    const walletTotalPnl = walletPositions.reduce((sum: number, p: any) => {
      return sum + parseFloat(p.realizedPnl || '0')
    }, 0)

    const walletWins = walletPositions.filter((p: any) => parseFloat(p.realizedPnl || '0') > 0)
    const walletLosses = walletPositions.filter((p: any) => parseFloat(p.realizedPnl || '0') < 0)

    console.log(`Total positions: ${walletPositions.length}`)
    console.log(`Total realized PnL: $${walletTotalPnl.toFixed(2)}`)
    console.log(`Winning positions: ${walletWins.length}`)
    console.log(`Losing positions: ${walletLosses.length}`)
    console.log(`Win rate: ${((walletWins.length / (walletWins.length + walletLosses.length)) * 100).toFixed(1)}%\n`)

    // Test 3: Check if positions have token IDs we can match to markets
    console.log('\n' + '='.repeat(50))
    console.log('📊 Test 3: Token ID Matching')
    console.log('-'.repeat(50) + '\n')

    const uniqueTokenIds = [...new Set(positions.map((p: any) => p.tokenId))]
    console.log(`Unique token IDs in sample: ${uniqueTokenIds.length}`)
    console.log(`Sample token IDs:`)
    uniqueTokenIds.slice(0, 5).forEach((tokenId: string) => {
      console.log(`  - ${tokenId}`)
    })

    // Summary
    console.log('\n' + '='.repeat(50))
    console.log('📋 SUMMARY')
    console.log('='.repeat(50) + '\n')

    console.log('✅ Goldsky PnL Subgraph IS WORKING')
    console.log(`✅ realizedPnl field exists and has data`)
    console.log(`✅ Coverage: ${((withRealizedPnl.length / positions.length) * 100).toFixed(1)}% of positions have non-zero PnL\n`)

    console.log('❓ CRITICAL QUESTION:')
    console.log('   Does Goldsky calculate realizedPnl from market resolutions?')
    console.log('   OR does it calculate from current prices (unrealized)?')
    console.log('\n   To test: Compare Goldsky PnL to our enrichment for SAME positions')
    console.log('   on markets we KNOW are resolved.\n')

    return {
      totalPositions: positions.length,
      withPnl: withRealizedPnl.length,
      coveragePercent: (withRealizedPnl.length / positions.length) * 100,
      sampleWallet: testWallet,
      samplePositionCount: walletPositions.length,
    }
  } catch (error) {
    console.error('❌ Error testing Goldsky PnL:', error)
    throw error
  }
}

// Run the test
testGoldskyPnLCoverage()
  .then((results) => {
    console.log('\n✅ Test completed successfully')
    console.log(`\nResults: ${JSON.stringify(results, null, 2)}`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })
