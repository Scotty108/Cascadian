#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

const DOME_API_BASE_URL = process.env.DOME_API_BASE_URL
const DOME_API_KEY = process.env.DOME_API_KEY

if (!DOME_API_BASE_URL || !DOME_API_KEY) {
  throw new Error('Missing DOME_API_BASE_URL or DOME_API_KEY in .env.local')
}

interface DomePnLResponse {
  pnl_over_time: Array<{
    timestamp: number
    pnl_to_date: number
  }>
}

interface ValidationResult {
  wallet: string
  our_pnl: number
  dome_pnl: number | null
  difference: number
  difference_pct: number
  our_markets: number
  status: 'excellent' | 'good' | 'acceptable' | 'needs_review' | 'api_error'
  error?: string
}

async function fetchDomePnL(wallet: string): Promise<number | null> {
  try {
    const url = `${DOME_API_BASE_URL}/polymarket/wallet/pnl/${wallet}?granularity=all`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${DOME_API_KEY}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      console.log(`    ⚠️  API ${response.status}`)
      return null
    }

    const data: DomePnLResponse = await response.json()

    if (!data.pnl_over_time || data.pnl_over_time.length === 0) {
      console.log(`    ⚠️  No data`)
      return null
    }

    const latestPnl = data.pnl_over_time[data.pnl_over_time.length - 1].pnl_to_date
    console.log(`    ✅ $${latestPnl.toLocaleString()}`)

    return latestPnl

  } catch (error: any) {
    console.log(`    ⚠️  ${error.message}`)
    return null
  }
}

async function validate100Wallets() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('DOME API VALIDATION: 100 REGULAR TRADERS (FILTERED)')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log('=' .repeat(80))
    console.log('')

    console.log('Filters applied:')
    console.log('  • Market count: 5-500 (excludes infrastructure wallets)')
    console.log('  • Absolute P&L: <$1M (excludes market makers)')
    console.log('')

    console.log('Step 1: Sampling 100 filtered wallets...')
    console.log('')

    const walletsQuery = await client.query({
      query: `
        SELECT
          wallet,
          sum(realized_pnl_usd) as total_pnl,
          count() as market_count
        FROM realized_pnl_by_market_final
        GROUP BY wallet
        HAVING market_count BETWEEN 5 AND 500
          AND abs(total_pnl) < 1000000
        ORDER BY abs(total_pnl) DESC
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })

    const wallets = await walletsQuery.json<Array<{
      wallet: string
      total_pnl: string
      market_count: string
    }>>()

    console.log(`✅ Sampled ${wallets.length} wallets`)
    console.log(`   Range: 5-500 markets, <$1M P&L`)
    console.log('')

    console.log('Step 2: Validating against Dome API (with 1s delay)...')
    console.log('')

    const results: ValidationResult[] = []
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i]
      const walletAddr = wallet.wallet
      const ourPnL = parseFloat(wallet.total_pnl)
      const ourMarkets = parseInt(wallet.market_count)

      console.log(`[${i + 1}/${wallets.length}] ${walletAddr.substring(0, 12)}... (${ourMarkets} markets)`)
      console.log(`  Our: $${ourPnL.toLocaleString()}`)

      const domePnL = await fetchDomePnL(walletAddr)

      if (domePnL === null) {
        errorCount++
        results.push({
          wallet: walletAddr,
          our_pnl: ourPnL,
          dome_pnl: null,
          difference: 0,
          difference_pct: 0,
          our_markets: ourMarkets,
          status: 'api_error'
        })
        console.log('')
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }

      const diff = ourPnL - domePnL
      const diffPct = domePnL !== 0 ? Math.abs((diff / domePnL) * 100) : 0

      let status: ValidationResult['status'] = 'excellent'
      if (diffPct > 5) {
        status = 'needs_review'
      } else if (diffPct > 2) {
        status = 'acceptable'
      } else if (diffPct > 1) {
        status = 'good'
      }

      const emoji = status === 'excellent' ? '✅' :
                    status === 'good' ? '✅' :
                    status === 'acceptable' ? '⚠️' : '❌'

      console.log(`  ${emoji} Diff: $${diff.toLocaleString()} (${diffPct.toFixed(2)}%)`)
      console.log('')

      successCount++
      results.push({
        wallet: walletAddr,
        our_pnl: ourPnL,
        dome_pnl: domePnL,
        difference: diff,
        difference_pct: diffPct,
        our_markets: ourMarkets,
        status
      })

      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // Summary
    console.log('=' .repeat(80))
    console.log('VALIDATION SUMMARY')
    console.log('=' .repeat(80))
    console.log('')

    const successfulResults = results.filter(r => r.status !== 'api_error')

    const excellent = successfulResults.filter(r => r.status === 'excellent').length
    const good = successfulResults.filter(r => r.status === 'good').length
    const acceptable = successfulResults.filter(r => r.status === 'acceptable').length
    const needsReview = successfulResults.filter(r => r.status === 'needs_review').length

    console.log(`Total wallets: ${wallets.length}`)
    console.log(`  ✅ Successfully compared: ${successCount}`)
    console.log(`  ❌ API errors: ${errorCount}`)
    console.log('')

    if (successfulResults.length > 0) {
      console.log('Accuracy Distribution:')
      console.log(`  ✅ Excellent (<1%):   ${excellent} (${(excellent / successfulResults.length * 100).toFixed(1)}%)`)
      console.log(`  ✅ Good (1-2%):       ${good} (${(good / successfulResults.length * 100).toFixed(1)}%)`)
      console.log(`  ⚠️  Acceptable (2-5%): ${acceptable} (${(acceptable / successfulResults.length * 100).toFixed(1)}%)`)
      console.log(`  ❌ Needs Review (>5%): ${needsReview} (${(needsReview / successfulResults.length * 100).toFixed(1)}%)`)
      console.log('')

      const avgError = successfulResults.reduce((sum, r) => sum + r.difference_pct, 0) / successfulResults.length
      const medianError = successfulResults
        .map(r => r.difference_pct)
        .sort((a, b) => a - b)[Math.floor(successfulResults.length / 2)]

      console.log(`Average error: ${avgError.toFixed(2)}%`)
      console.log(`Median error:  ${medianError.toFixed(2)}%`)
      console.log('')
    }

    // Outliers
    const outliers = successfulResults.filter(r => r.status === 'needs_review')
    if (outliers.length > 0 && outliers.length <= 10) {
      console.log('Outliers (>5% error):')
      outliers.forEach(r => {
        console.log(`  ${r.wallet.substring(0, 12)}...`)
        console.log(`    Our:   $${r.our_pnl.toLocaleString()}`)
        console.log(`    Dome:  $${r.dome_pnl!.toLocaleString()}`)
        console.log(`    Error: ${r.difference_pct.toFixed(2)}%`)
      })
      console.log('')
    }

    // Save CSV
    const csvPath = 'tmp/dome-validation-100-filtered.csv'
    const csvHeader = 'wallet,our_pnl,dome_pnl,difference,difference_pct,our_markets,status\n'
    const csvRows = results.map(r => {
      return [
        r.wallet,
        r.our_pnl.toFixed(2),
        r.dome_pnl !== null ? r.dome_pnl.toFixed(2) : 'NULL',
        r.difference.toFixed(2),
        r.difference_pct.toFixed(2),
        r.our_markets,
        r.status
      ].join(',')
    }).join('\n')

    writeFileSync(csvPath, csvHeader + csvRows)
    console.log(`📊 Results saved to: ${csvPath}`)
    console.log('')

    // Final verdict
    console.log('=' .repeat(80))
    console.log('FINAL VERDICT')
    console.log('=' .repeat(80))
    console.log('')

    if (successfulResults.length === 0) {
      console.log('❌ NO DATA: All API calls failed')
    } else {
      const passRate = ((excellent + good) / successfulResults.length * 100).toFixed(1)

      if (excellent + good >= successfulResults.length * 0.95) {
        console.log(`✅ EXCELLENT: ${passRate}% within 2% error`)
        console.log('   P&L calculations are production-ready')
      } else if (excellent + good + acceptable >= successfulResults.length * 0.90) {
        console.log(`✅ GOOD: ${passRate}% within 2%, ${((excellent + good + acceptable) / successfulResults.length * 100).toFixed(1)}% within 5%`)
        console.log('   P&L calculations are acceptable')
      } else {
        console.log(`⚠️  NEEDS WORK: Only ${passRate}% within 2%`)
        console.log('   Review outliers before deployment')
      }
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

validate100Wallets()
