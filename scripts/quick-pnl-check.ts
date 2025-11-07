#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

// Target wallets with expected P&L values
const WALLETS = [
  { name: 'niggemon', address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', expected: 102001.46 },
  { name: 'HolyMoses7', address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', expected: 89975.16 },
  { name: 'LucasMeow', address: '0x7f3c8979d0afa00007bae4747d5347122af05613', expected: 179243 },
  { name: 'xcnstrategy', address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', expected: 94730 }
]

// Based on the documentation, these are the key tables with P&L data
const PNL_TABLES = [
  'trades_raw',
  'trades_with_pnl',
  'vw_trades_canonical',
  'vw_trades_canonical_v2',
  'trades_with_direction',
  'trades_with_recovered_cid'
]

async function queryTable(table: string, walletAddress: string, walletName: string) {
  try {
    // Different P&L column names in different tables
    const queries = [
      `realized_pnl_usd`,
      `pnl`,
      `pnl_gross`,
      `pnl_net`,
      `pnl_usd`
    ]

    const results: any[] = []

    for (const pnlCol of queries) {
      try {
        const query = `
          SELECT
            COUNT(*) as trade_count,
            SUM(${pnlCol}) as total_pnl,
            MIN(timestamp) as first_trade,
            MAX(timestamp) as last_trade
          FROM ${table}
          WHERE lower(wallet_address) = lower('${walletAddress}')
            AND ${pnlCol} IS NOT NULL
            AND ${pnlCol} != 0
        `

        const result = await clickhouse.query({ query, format: 'JSONEachRow' })
        const data = await result.json() as any[]

        if (data.length > 0 && parseFloat(data[0].trade_count) > 0) {
          results.push({
            column: pnlCol,
            ...data[0]
          })
        }
      } catch (err: any) {
        // Column doesn't exist or other error, skip
      }
    }

    return results
  } catch (err: any) {
    console.log(`  ❌ Error querying ${table}: ${err.message}`)
    return []
  }
}

async function main() {
  console.log('🔍 QUICK P&L CHECK - Key Tables Only')
  console.log('=' .repeat(80))
  console.log('\n')

  const allFindings: any[] = []

  for (const wallet of WALLETS) {
    console.log(`\n💼 ${wallet.name} (${wallet.address})`)
    console.log(`   Expected P&L: $${wallet.expected.toLocaleString()}`)
    console.log('   ' + '-'.repeat(76))

    for (const table of PNL_TABLES) {
      const results = await queryTable(table, wallet.address, wallet.name)

      if (results.length > 0) {
        console.log(`\n   📊 ${table}:`)
        results.forEach((r: any) => {
          const pnlValue = parseFloat(r.total_pnl) || 0
          const matchPct = (pnlValue / wallet.expected) * 100
          const matchEmoji = matchPct >= 50 ? '✅' : matchPct >= 25 ? '⚠️' : matchPct >= 10 ? '📊' : '❌'

          console.log(`      ${matchEmoji} ${r.column}: $${pnlValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
          console.log(`         Match: ${matchPct.toFixed(1)}% | Trades: ${r.trade_count} | ${r.first_trade?.substring(0,10)} → ${r.last_trade?.substring(0,10)}`)

          allFindings.push({
            wallet: wallet.name,
            expected: wallet.expected,
            table,
            column: r.column,
            actual: pnlValue,
            matchPct,
            tradeCount: r.trade_count
          })
        })
      }
    }
  }

  // Summary
  console.log('\n\n')
  console.log('=' .repeat(80))
  console.log('📈 SUMMARY - Best Matches')
  console.log('=' .repeat(80))
  console.log('\n')

  if (allFindings.length === 0) {
    console.log('❌ NO P&L DATA FOUND IN ANY KEY TABLE')
    return
  }

  // Sort by match percentage
  allFindings.sort((a: any, b: any) => b.matchPct - a.matchPct)

  // Group by wallet and show best match
  for (const wallet of WALLETS) {
    const walletFindings = allFindings.filter((f: any) => f.wallet === wallet.name)

    if (walletFindings.length === 0) {
      console.log(`❌ ${wallet.name}: NO DATA FOUND`)
      continue
    }

    const best = walletFindings[0]
    const matchEmoji = best.matchPct >= 50 ? '✅' : best.matchPct >= 25 ? '⚠️' : '❌'

    console.log(`${matchEmoji} ${wallet.name}:`)
    console.log(`   Best Match: ${best.table}.${best.column}`)
    console.log(`   Value: $${best.actual.toLocaleString(undefined, {minimumFractionDigits: 2})} (${best.matchPct.toFixed(1)}% of expected $${best.expected.toLocaleString()})`)
    console.log(`   Trades: ${best.tradeCount}`)

    // Show alternatives if any are close
    const alternatives = walletFindings.slice(1, 3).filter((f: any) => f.matchPct >= 10)
    if (alternatives.length > 0) {
      console.log(`   Alternatives:`)
      alternatives.forEach((alt: any) => {
        console.log(`      - ${alt.table}.${alt.column}: $${alt.actual.toLocaleString()} (${alt.matchPct.toFixed(1)}%)`)
      })
    }
    console.log()
  }

  // Final recommendation
  console.log('\n' + '=' .repeat(80))
  console.log('🎯 RECOMMENDATION')
  console.log('=' .repeat(80))
  console.log('\n')

  const bestOverall = allFindings[0]
  if (bestOverall.matchPct >= 50) {
    console.log(`✅ Found good matches! Best source: ${bestOverall.table}.${bestOverall.column}`)
    console.log(`   Average match across wallets: ${(allFindings.slice(0, 4).reduce((sum: number, f: any) => sum + f.matchPct, 0) / 4).toFixed(1)}%`)
  } else {
    console.log(`⚠️  No table shows values >50% of expected P&L`)
    console.log(`   Best match is only ${bestOverall.matchPct.toFixed(1)}%`)
    console.log(`\n   Possible reasons:`)
    console.log(`   1. Expected values are from a different calculation method`)
    console.log(`   2. Expected values include unrealized P&L, but tables only have realized`)
    console.log(`   3. Expected values are from external source (Polymarket UI, not our DB)`)
    console.log(`   4. Data needs to be recalculated with correct formula`)
  }

  console.log('\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
