#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

// Dome baseline wallets
const DOME_WALLETS = [
  '0x7f3c8979d0afa00007bae4747d5347122af05613', // Wallet 1 (target)
  '0x8cb94cc0b891286430519cec45ee9e7d9438a1fa', // Wallet 2
  '0xeb0513d7e199678891300c5ad7e00ebc1c0012f8', // Wallet 3
  '0xeb6f1d2e5f31a68ca3f1b0fb9e9c3f5e5d2a1b3c', // Wallet 4
]

interface DomeWalletData {
  wallet: string
  totalPnl: number
  markets: Array<{
    marketId: string
    pnl: number
  }>
}

async function fetchDomeAPI(wallet: string): Promise<DomeWalletData | null> {
  try {
    // Fetch from Polymarket's wallet analytics endpoint
    const response = await fetch(`https://data-api.polymarket.com/wallet/${wallet}`, {
      headers: {
        'Accept': 'application/json',
      }
    })

    if (!response.ok) {
      console.log(`  ⚠️  Dome API returned ${response.status} for ${wallet}`)
      return null
    }

    const data = await response.json()

    // Parse Dome response structure
    return {
      wallet,
      totalPnl: data.totalPnl || 0,
      markets: data.markets || []
    }
  } catch (error: any) {
    console.log(`  ⚠️  Error fetching Dome API: ${error.message}`)
    return null
  }
}

async function compareDomeVsOurs() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('DOME API VS OUR P&L COMPARISON')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log('=' .repeat(80))
    console.log('')

    const results: any[] = []

    for (const wallet of DOME_WALLETS) {
      console.log(`Wallet: ${wallet}`)
      console.log('-'.repeat(80))

      // Fetch from Dome API
      console.log('  Fetching from Dome API...')
      const domeData = await fetchDomeAPI(wallet)

      if (!domeData) {
        console.log('  ⚠️  Skipping wallet (Dome API unavailable)\n')
        continue
      }

      const domePnL = domeData.totalPnl

      // Get our calculated P&L
      const ourResult = await client.query({
        query: `
          SELECT sum(realized_pnl_usd) as total_pnl
          FROM realized_pnl_by_market_final
          WHERE wallet = '${wallet}'
        `,
        format: 'JSONEachRow'
      })
      const ourData = await ourResult.json<any[]>()
      const ourPnL = parseFloat(ourData[0]?.total_pnl || '0')

      // Get market count
      const marketCountResult = await client.query({
        query: `
          SELECT count() as count
          FROM realized_pnl_by_market_final
          WHERE wallet = '${wallet}'
        `,
        format: 'JSONEachRow'
      })
      const marketCountData = await marketCountResult.json<any[]>()
      const ourMarketCount = parseInt(marketCountData[0].count)

      // Calculate difference
      const diff = ourPnL - domePnL
      const diffPct = domePnL !== 0 ? ((diff / Math.abs(domePnL)) * 100) : 0
      const accuracy = 100 - Math.abs(diffPct)

      console.log(`  Dome API P&L:    $${domePnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`  Our P&L:         $${ourPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`  Difference:      $${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${diffPct.toFixed(2)}%)`)
      console.log(`  Accuracy:        ${accuracy.toFixed(2)}%`)
      console.log(`  Our markets:     ${ourMarketCount}`)

      // Determine status
      let status = '✅ EXCELLENT'
      if (Math.abs(diffPct) > 5) {
        status = '❌ NEEDS REVIEW'
      } else if (Math.abs(diffPct) > 2) {
        status = '⚠️  ACCEPTABLE'
      } else if (Math.abs(diffPct) > 1) {
        status = '✅ GOOD'
      }

      console.log(`  Status:          ${status}`)
      console.log('')

      results.push({
        wallet,
        domePnL,
        ourPnL,
        diff,
        diffPct,
        accuracy,
        ourMarketCount,
        status
      })
    }

    // Summary
    console.log('=' .repeat(80))
    console.log('ACCURACY SUMMARY')
    console.log('=' .repeat(80))
    console.log('')

    const excellent = results.filter(r => r.status.includes('EXCELLENT')).length
    const good = results.filter(r => r.status.includes('GOOD')).length
    const acceptable = results.filter(r => r.status.includes('ACCEPTABLE')).length
    const needsReview = results.filter(r => r.status.includes('NEEDS REVIEW')).length

    console.log(`Total wallets compared: ${results.length}`)
    console.log(`  ✅ Excellent (<1% error):   ${excellent}`)
    console.log(`  ✅ Good (1-2% error):       ${good}`)
    console.log(`  ⚠️  Acceptable (2-5% error): ${acceptable}`)
    console.log(`  ❌ Needs Review (>5% error): ${needsReview}`)
    console.log('')

    if (results.length > 0) {
      const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / results.length
      const avgDiff = results.reduce((sum, r) => sum + Math.abs(r.diffPct), 0) / results.length

      console.log(`Average accuracy: ${avgAccuracy.toFixed(2)}%`)
      console.log(`Average error:    ${avgDiff.toFixed(2)}%`)
      console.log('')
    }

    if (needsReview > 0) {
      console.log('Wallets needing review:')
      results.filter(r => r.status.includes('NEEDS REVIEW')).forEach(r => {
        console.log(`  - ${r.wallet.substring(0, 10)}... : ${r.diffPct.toFixed(2)}% error`)
      })
      console.log('')
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

compareDomeVsOurs()
