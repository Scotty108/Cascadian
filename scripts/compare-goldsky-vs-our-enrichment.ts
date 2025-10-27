#!/usr/bin/env npx tsx

/**
 * Compare Goldsky realizedPnl vs Our Enrichment
 *
 * Critical test: Take positions from our enriched trades and compare
 * the P&L we calculated vs what Goldsky reports.
 *
 * This will tell us if Goldsky's realizedPnl is:
 * - Accurate (we can use it!)
 * - Scaled wrong (need correction factor)
 * - Completely bogus (can't use it)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient as createClickHouseClient } from '@clickhouse/client'
import { pnlClient } from '../lib/goldsky/client'

const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_URL!,
  database: 'cascadian',
})

const GET_WALLET_PNL_FROM_GOLDSKY = /* GraphQL */ `
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

async function compareGoldskyVsEnrichment() {
  console.log('🔍 Comparing Goldsky PnL vs Our Enrichment\n')
  console.log('='.repeat(60) + '\n')

  try {
    // Step 1: Get a sample of enriched trades from our database
    console.log('📊 Step 1: Fetching enriched trades from ClickHouse')
    console.log('-'.repeat(60))

    const ourTradesQuery = `
      SELECT
        wallet,
        token_id,
        gross_pnl_usd,
        net_pnl_usd,
        outcome,
        shares,
        entry_price,
        exit_price
      FROM trades_raw
      WHERE gross_pnl_usd IS NOT NULL
        AND gross_pnl_usd != 0
      LIMIT 20
    `

    const ourTradesResult = await clickhouse.query({
      query: ourTradesQuery,
      format: 'JSONEachRow',
    })

    const ourTrades: any[] = await ourTradesResult.json()

    console.log(`Found ${ourTrades.length} enriched trades\n`)

    if (ourTrades.length === 0) {
      console.log('❌ No enriched trades found. Run enrichment first.')
      return
    }

    // Step 2: Get unique wallets from our enriched trades
    const uniqueWallets = [...new Set(ourTrades.map((t: any) => t.wallet))]
    console.log(`Unique wallets in sample: ${uniqueWallets.length}`)

    // Step 3: For each wallet, fetch Goldsky PnL data
    console.log('\n📊 Step 2: Fetching same wallets from Goldsky')
    console.log('-'.repeat(60) + '\n')

    for (const wallet of uniqueWallets.slice(0, 3)) {
      // Test first 3 wallets
      console.log(`\nWallet: ${wallet}`)
      console.log('─'.repeat(60))

      // Get our enriched trades for this wallet
      const ourWalletTrades = ourTrades.filter((t: any) => t.wallet === wallet)
      const ourTotalPnl = ourWalletTrades.reduce((sum: number, t: any) => {
        return sum + parseFloat(t.net_pnl_usd || '0')
      }, 0)

      console.log(`\n  OUR DATA:`)
      console.log(`    Trades: ${ourWalletTrades.length}`)
      console.log(`    Total Net PnL: $${ourTotalPnl.toFixed(2)}`)

      // Show first 3 trades
      console.log(`\n    Sample trades:`)
      ourWalletTrades.slice(0, 3).forEach((t: any, i: number) => {
        console.log(`      [${i + 1}] Token ID: ${t.token_id.substring(0, 20)}...`)
        console.log(`          Outcome: ${t.outcome}, Shares: ${t.shares}`)
        console.log(`          Entry: ${parseFloat(t.entry_price).toFixed(4)}, Exit: ${parseFloat(t.exit_price).toFixed(4)}`)
        console.log(`          Net PnL: $${parseFloat(t.net_pnl_usd).toFixed(2)}`)
      })

      // Get Goldsky data
      try {
        const goldskyData = await pnlClient.request<any>(GET_WALLET_PNL_FROM_GOLDSKY, {
          wallet: wallet.toLowerCase(),
        })

        const goldskyPositions = goldskyData.userPositions || []

        if (goldskyPositions.length === 0) {
          console.log(`\n  ❌ GOLDSKY: No positions found for this wallet`)
          continue
        }

        const goldskyTotalPnl = goldskyPositions.reduce((sum: number, p: any) => {
          return sum + parseFloat(p.realizedPnl || '0')
        }, 0)

        console.log(`\n  GOLDSKY DATA:`)
        console.log(`    Positions: ${goldskyPositions.length}`)
        console.log(`    Total Realized PnL: $${goldskyTotalPnl.toFixed(2)}`)

        // Try to match token IDs
        console.log(`\n    Attempting to match token IDs...`)
        let matched = 0
        for (const ourTrade of ourWalletTrades.slice(0, 5)) {
          const goldskyPos = goldskyPositions.find(
            (p: any) => p.tokenId === ourTrade.token_id
          )

          if (goldskyPos) {
            matched++
            const ourPnl = parseFloat(ourTrade.net_pnl_usd)
            const goldskyPnl = parseFloat(goldskyPos.realizedPnl)
            const ratio = goldskyPnl / ourPnl

            console.log(`\n      ✅ MATCH FOUND!`)
            console.log(`         Token ID: ${ourTrade.token_id.substring(0, 20)}...`)
            console.log(`         Our PnL:      $${ourPnl.toFixed(2)}`)
            console.log(`         Goldsky PnL:  $${goldskyPnl.toFixed(2)}`)
            console.log(`         Ratio:        ${ratio.toFixed(2)}x ${ratio > 10 ? '🚨 HUGE DIFFERENCE' : ratio > 2 ? '⚠️  Mismatch' : '✅ Close'}`)
          }
        }

        console.log(`\n    Matched ${matched}/${Math.min(ourWalletTrades.length, 5)} token IDs`)

        // Compare totals
        console.log(`\n  📊 COMPARISON:`)
        console.log(`    Our Total PnL:      $${ourTotalPnl.toFixed(2)}`)
        console.log(`    Goldsky Total PnL:  $${goldskyTotalPnl.toFixed(2)}`)

        if (Math.abs(ourTotalPnl) > 0) {
          const totalRatio = goldskyTotalPnl / ourTotalPnl
          console.log(`    Ratio:              ${totalRatio.toFixed(2)}x`)

          if (Math.abs(totalRatio - 13.24) < 1) {
            console.log(`    🚨 THIS IS THE 13.24x GOLDSKY CORRECTION FACTOR!`)
          } else if (Math.abs(totalRatio) > 100) {
            console.log(`    🚨 GOLDSKY DATA APPEARS CORRUPTED OR SCALED WRONG`)
          } else if (Math.abs(totalRatio - 1) < 0.1) {
            console.log(`    ✅ GOLDSKY DATA MATCHES OUR ENRICHMENT!`)
          }
        }
      } catch (error) {
        console.log(`\n  ❌ Error fetching Goldsky data: ${error}`)
      }
    }

    // Final summary
    console.log('\n\n' + '='.repeat(60))
    console.log('📋 CONCLUSION')
    console.log('='.repeat(60) + '\n')

    console.log('Based on this comparison, we can determine:')
    console.log('1. If Goldsky PnL is accurate → Use it directly!')
    console.log('2. If Goldsky PnL is 13.24x too high → Apply correction factor')
    console.log('3. If Goldsky PnL is wildly different → Cannot use it\n')
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

compareGoldskyVsEnrichment()
  .then(() => {
    console.log('\n✅ Comparison complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Comparison failed:', error)
    process.exit(1)
  })
