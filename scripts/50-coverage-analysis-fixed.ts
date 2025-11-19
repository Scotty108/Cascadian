#!/usr/bin/env npx tsx

/**
 * COVERAGE ANALYSIS - Fixed version
 * Determine what percentage of each wallet's trades are covered by trades_working
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('COVERAGE ANALYSIS: What % of trades does trades_working cover per wallet?')
  console.log('='.repeat(100))

  // Get coverage stats by binning coverage percentages
  const coverageDistribution = await (await clickhouse.query({
    query: `
      WITH wallet_coverage AS (
        SELECT
          wallet_address,
          COUNT(*) as total_trades_raw,
          SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as trades_with_id,
          ROUND(SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as pct_coverage
        FROM trades_raw
        GROUP BY wallet_address
      )
      SELECT
        pct_coverage,
        COUNT(*) as wallet_count,
        SUM(total_trades_raw) as total_trades_in_bin,
        SUM(trades_with_id) as trades_with_id_in_bin
      FROM wallet_coverage
      GROUP BY pct_coverage
      ORDER BY pct_coverage DESC
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log('\n[COVERAGE DISTRIBUTION BY WALLET]\n')
  console.log('Coverage %  | Wallet Count | Total Trades | Trades w/ ID | % of all trades')
  console.log('─'.repeat(80))

  let totalWallets = 0
  let totalTrades = 0
  let totalTradesWithId = 0
  let wallets100Pct = 0
  let wallets0Pct = 0

  for (const row of coverageDistribution) {
    const pct = parseFloat(row.pct_coverage)
    const walletCount = parseInt(row.wallet_count)
    const tradesInBin = parseInt(row.total_trades_in_bin)
    const tradesWithId = parseInt(row.trades_with_id_in_bin)

    totalWallets += walletCount
    totalTrades += tradesInBin
    totalTradesWithId += tradesWithId

    if (pct === 100) wallets100Pct += walletCount
    if (pct === 0) wallets0Pct += walletCount

    const pctOfAll = ((tradesInBin / totalTrades) * 100).toFixed(1)
    console.log(
      `${pct.toString().padEnd(10)} | ${walletCount.toString().padEnd(12)} | ${tradesInBin.toString().padEnd(12)} | ${tradesWithId.toString().padEnd(12)} | ${pctOfAll}%`
    )
  }

  console.log('─'.repeat(80))
  console.log(`TOTAL        | ${totalWallets.toString().padEnd(12)} | ${totalTrades.toString().padEnd(12)} | ${totalTradesWithId.toString().padEnd(12)} | 100.0%\n`)

  console.log('[SUMMARY STATISTICS]')
  console.log(`Total wallets: ${totalWallets.toLocaleString()}`)
  console.log(`Wallets with 100% coverage: ${wallets100Pct.toLocaleString()} (${(wallets100Pct/totalWallets*100).toFixed(2)}%)`)
  console.log(`Wallets with 0% coverage: ${wallets0Pct.toLocaleString()} (${(wallets0Pct/totalWallets*100).toFixed(2)}%)`)
  console.log(`Overall coverage: ${(totalTradesWithId/totalTrades*100).toFixed(2)}%`)

  console.log('\n' + '='.repeat(100))
  console.log('[KEY INSIGHT]')
  console.log('='.repeat(100))

  if (wallets0Pct > 0) {
    console.log(`\n⚠️  CRITICAL: ${wallets0Pct.toLocaleString()} wallets (${(wallets0Pct/totalWallets*100).toFixed(2)}%) have ZERO trades with condition_ids`)
    console.log(`   These wallets are completely missing from any analysis - 100% data loss`)
  }

  if (wallets100Pct < totalWallets * 0.01) {
    console.log(`\n⚠️  CRITICAL: Only ${(wallets100Pct/totalWallets*100).toFixed(2)}% of wallets have 100% coverage`)
    console.log(`   ${wallets0Pct + Math.round((totalWallets - wallets100Pct - wallets0Pct) * 0.99)} wallets have partial coverage`)
  }

  console.log(`\n💡 IMPLICATION: Even with "trades_working" (all condition_ids populated),`)
  console.log(`   you would still have only ${(totalTradesWithId/totalTrades*100).toFixed(2)}% of the original trading volume.`)
  console.log(`   The other ${((totalTrades - totalTradesWithId)/totalTrades*100).toFixed(2)}% is permanently missing (empty condition_ids).`)

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
